import { Database } from 'bun:sqlite';
import type { Primitive } from 'vanjs-core';

export interface Deck {
  id: string;
  name: string;
  /**
   * 预设的前端组件名称，接受 val prop 渲染 card.front / card.back
   * @example `'front,back'`
   */
  component: string;
}
export interface Card {
  id: string;
  deck_id: string;
  front: string;
  back: string;
}
export interface Scheduler {
  query(deck_id: string, limit: number): Card[];
  update(card_id: string, answer: boolean, now: number): void;
}

export const db = new Database('db.sqlite');
db.run('PRAGMA foreign_keys = ON');

const query_decks_sql = db.prepare('select * from deck');
const query_deck_component_sql = db.prepare(
  'select component from deck where id = ?',
);
const insert_session_sql = db.prepare(
  'insert into review_session (id) values (?)',
);

const record_keys = [
  'card_id',
  'answer',
  'started_at',
  'revealed_at',
  'answered_at',
];
const insert_record_sql = db.prepare(
  `insert into review_record (session_id,${record_keys.join(',')}) values (?,${'?,'
    .repeat(record_keys.length)
    .slice(0, -1)})`,
);

const scheduler = await import('./fsrs').then((m) => m.default);
Bun.serve({
  routes: {
    '/api/decks': {
      GET() {
        return Response.json(query_decks_sql.all());
      },
    },
    '/api/deck/:id/cards': {
      GET(ctx) {
        const { component } = query_deck_component_sql.get(
          ctx.params.id,
        ) as Deck;
        const [front_is_file, back_is_file] = component
          .split(',', 2)
          .map((e) => e == 'video' || e == 'audio');

        const rows = scheduler.query(ctx.params.id, 20);
        if (front_is_file || back_is_file) {
          for (const row of rows) {
            if (front_is_file) row.front = `api/card/${row.id}/front/file`;
            if (back_is_file) row.back = `api/card/${row.id}/back/file`;
          }
        }
        return Response.json(rows);
      },
    },
    '/api/session': {
      GET() {
        const session_id = crypto.randomUUID();
        insert_session_sql.run(session_id);
        return Response.json(session_id);
      },
    },
    '/api/session/:id/record': {
      async POST(ctx) {
        const data = await ctx.json();
        const values: Primitive[] = [];

        // record
        for (const k of record_keys) {
          const v = data[k];
          if (v == null) return new Response(`require field ${k}, got ${v}`);
          values.push(v);
        }
        insert_record_sql.run(ctx.params.id, ...values);

        // update state
        scheduler.update(data['card_id'], data['answer'], data['answered_at']);

        return new Response('');
      },
    },
    '/api/card/:id/:side/file': {
      GET(ctx) {
        const { id, side } = ctx.params;
        if (side != 'front' && side != 'back') {
          return new Response('Invalid side', { status: 400 });
        }

        const row = db
          .query(`SELECT ${side} FROM card WHERE id = ?`)
          .get(id) as Card;
        if (!row) {
          return new Response('No row ' + id, { status: 400 });
        }

        const filepath = row[side];
        const file = Bun.file(filepath);
        return new Response(file);
      },
    },
  },
});
