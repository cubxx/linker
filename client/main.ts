import { createApp, getCurrentScene, on, type NodeLike } from 'psytask';
import van from 'vanjs-core';
import type { Card, Deck } from '../server';

const { div, button, audio, video, textarea } = van.tags;
type CardComponent = (props: { value: () => string }) => NodeLike;
const card_components: Record<string, CardComponent> = {
  text(props) {
    return div({ class: 'text-xl whitespace-pre-wrap' }, props.value);
  },
  tts(props) {
    const loading = van.state(false);
    const speak = () => {
      if (!window['speechSynthesis']) {
        alert('not support speechSynthesis');
        return;
      }
      speechSynthesis.cancel();

      const text = props.value();
      if (!text) return;

      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.6;
      u.onstart = u.onerror = () => (loading.val = false);

      speechSynthesis.speak(u);
      loading.val = true;
    };
    van.derive(speak);

    return div(
      {
        class: 'text-xl whitespace-pre-wrap',
        title: 'click to speak',
        onclick: speak,
      },
      props.value,
      div({ hidden: () => !loading.val, class: 'loading loading-spin' }),
    );
  },
  audio(props) {
    return audio({
      src: props.value,
      controls: true,
      preload: 'metadata',
      class: 'w-full',
    });
  },
  video(props) {
    return video({
      src: props.value,
      controls: true,
      preload: 'metadata',
      class: 'w-full h-auto',
    });
  },
};
const to_unix = (t: number) => Math.round(performance.timeOrigin + t);

using app = await createApp();
using deck_selector = app.scene(
  () => {
    const decks = van.state<Deck[]>([]);
    fetch('api/decks')
      .then((r) => r.json())
      .then((d) => (decks.val = d));

    let data: {
      deck: Deck | null;
      cards: Card[];
      session_id: string;
    } = { deck: null, cards: [], session_id: '' };
    const ctx = getCurrentScene().on('show', () => {
      data = { deck: null, cards: [], session_id: '' };
    });

    const node = div(() =>
      div(
        {
          class:
            'm-8 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] auto-rows-[100px] gap-4',
        },
        decks.val.map((item) =>
          button(
            {
              class:
                'rounded-xl outline hover:bg-primary hover:text-primary-content transition-colors',
              async onclick() {
                data.deck = item;
                data.cards = await fetch(`api/deck/${item.id}/cards`).then(
                  (r) => r.json(),
                );
                if (data.cards.length == 0) {
                  alert('no cards to review');
                  ctx.close();
                  return;
                }

                data.session_id = await fetch(`api/session`).then((r) =>
                  r.json(),
                );
                if (data.session_id) ctx.close();
              },
            },
            item.name,
          ),
        ),
      ),
    );
    return { node, data: () => data };
  },
  { defaultProps: {} },
);
using card_display = app.scene(
  (props: { deck: Deck | null; card: Card | null; session_id: string }) => {
    const card = van.state<Card | null>(null);
    const comps = van.state<{
      front: CardComponent;
      back: CardComponent;
    } | null>(null);
    const has_revealed = van.state(false);
    const card_back = van.derive(() =>
      has_revealed.val ? card.val?.back : void 0,
    );

    let started_at = 0,
      revealed_at = 0;
    const ctx = getCurrentScene().on('show', () => {
      card.val = props.card;
      if (props.deck) {
        const [front_name, back_name] = props.deck.component.split(',', 2);
        comps.val =
          !front_name || !back_name
            ? null
            : {
                front: card_components[front_name]!,
                back: card_components[back_name]!,
              };
      }

      revealed_at = 0;
      started_at = 0;
      ctx.once('frame', (t) => (started_at = to_unix(t)));
    });

    const reveal = (evt: Event) => {
      has_revealed.val = true;
      revealed_at = to_unix(evt.timeStamp);
    };
    const submit = async (answer: boolean, evt: Event) => {
      if (!card.val) return;
      const err = await fetch(`api/session/${props.session_id}/record`, {
        method: 'post',
        body: JSON.stringify({
          card_id: card.val.id,
          answer,
          started_at,
          revealed_at,
          answered_at: to_unix(evt.timeStamp),
        }),
      }).then((r) => r.text());
      if (err) return alert(err);
      has_revealed.val = false;
      ctx.close();
    };
    ctx.on(
      'dispose',
      on(ctx.root, 'keydown', (evt) => {
        if (evt.key == ' ') {
          if (has_revealed.val) submit(true, evt);
          else reveal(evt);
          return;
        }
        if (evt.key == 'f') {
          if (has_revealed.val) submit(false, evt);
          return;
        }
      }),
    );

    return div(
      { class: 'h-full card' },
      div(
        { class: 'card-body overflow-y-auto' },
        div({ class: 'flex-1' }, () =>
          comps.val?.front
            ? comps.val.front({ value: () => card.val?.front ?? '' })
            : 'no front comp',
        ),
        textarea({ class: 'flex-1 textarea w-full' }),
        div(
          { class: 'flex-1', hidden: () => !has_revealed.val },
          div({ class: 'divider' }),
          () =>
            comps.val?.back
              ? comps.val.back({ value: () => card_back.val ?? '' })
              : 'no back comp',
        ),
      ),
      // actions
      div(
        { class: 'm-4 grid grid-flow-col gap-3' },
        button(
          {
            hidden: () => has_revealed.val,
            class: 'btn btn-primary btn-soft',
            onclick: reveal,
          },
          'Show Answer',
        ),
        button(
          {
            hidden: () => !has_revealed.val,
            class: 'btn btn-error btn-soft',
            onclick: (e) => submit(false, e),
          },
          'Wrong',
        ),
        button(
          {
            hidden: () => !has_revealed.val,
            class: 'btn btn-success btn-soft',
            onclick: (e) => submit(true, e),
          },
          'Correct',
        ),
      ),
    );
  },
  { defaultProps: { deck: null, card: null, session_id: '' } },
);

while (true) {
  const { deck, cards, session_id } = await deck_selector.show();
  for (const card of cards) {
    await card_display.show({ deck, card, session_id });
  }
}
