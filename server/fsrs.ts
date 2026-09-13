import {
  createEmptyCard,
  fsrs,
  Rating,
  type Card,
  type CardInput,
} from 'ts-fsrs';
import { db, type Scheduler } from '.';

const scheduler = fsrs();

const query_card_sql = db.prepare(`
  SELECT
    c.*
  FROM card c
  LEFT JOIN state_fsrs6 s
    ON s.card_id = c.id
  WHERE c.deck_id = ?
    AND (
      s.card_id IS NULL
      OR s.due <= unixepoch('subsec') * 1e3
    )
  ORDER BY
    s.card_id IS NOT NULL,
    s.due
  LIMIT ?
`);
const query_state_sql = db.prepare(
  'select * from state_fsrs6 where card_id = ?',
);
const insert_state_sql = db.prepare(`
  insert into state_fsrs6 (
    card_id,
    state,
    due,
    stability,
    difficulty,
    scheduled_days,
    learning_steps,
    reps,
    lapses,
    last_review
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const update_state_sql = db.prepare(`
  update state_fsrs6 set
    state = ?,
    due = ?,
    stability = ?,
    difficulty = ?,
    scheduled_days = ?,
    learning_steps = ?,
    reps = ?,
    lapses = ?,
    last_review = ?
  where card_id = ?
`);

export default {
  query(deck_id, limit) {
    return query_card_sql.all(deck_id, limit) as any[];
  },
  update(card_id, answer, now) {
    let row = query_state_sql.get(card_id) as CardInput | null;
    const card = row ?? createEmptyCard<Card>(now);
    const next = scheduler.next(
      card,
      now,
      answer ? Rating.Good : Rating.Again,
    ).card;

    if (row)
      update_state_sql.run(
        next.state,
        +next.due,
        next.stability,
        next.difficulty,
        next.scheduled_days,
        next.learning_steps,
        next.reps,
        next.lapses,
        next.last_review ? +next.last_review : null,
        card_id,
      );
    else
      insert_state_sql.run(
        card_id,
        next.state,
        +next.due,
        next.stability,
        next.difficulty,
        next.scheduled_days,
        next.learning_steps,
        next.reps,
        next.lapses,
        next.last_review ? +next.last_review : null,
      );
  },
} satisfies Scheduler;
