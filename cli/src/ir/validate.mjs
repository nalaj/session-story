/**
 * Structural + completeness validation for the Story IR (story.json).
 * Hand-written on purpose: the project has zero npm runtime dependencies,
 * so this does not pull in a JSON Schema engine. schemas/story.schema.json
 * documents the same shape for humans and external tooling.
 */

import { EVENT_KINDS, EVENT_STATUSES, DURATION_SOURCES } from './trace.mjs';
import { FINAL_STATES, METRIC_GROUPS } from './metrics.mjs';

const REQUIRED_EDIT_FIELDS = ['id', 'tool', 'file', 'rel', 'hunks', 'stats'];
const REQUIRED_TURN_FIELDS = ['index', 'id', 'prompt', 'edits'];
const OUTCOME_VALUES = ['completed', 'partial', 'failed', 'blocked'];
/** The header is a heading and one tight paragraph; keep both readable there. */
const TITLE_MAX = 60;
const SUMMARY_MAX = 240;
/** A turn's answer stands in for Claude's replies; a few sentences at most. */
const ANSWER_MAX = 400;

function pushIfMissing(errors, obj, field, prefix) {
  if (obj[field] === undefined) {
    errors.push(`${prefix}.${field} is required but missing`);
  }
}

export function validateStory(story, { strict = false } = {}) {
  const errors = [];

  if (!story || typeof story !== 'object') {
    return { valid: false, errors: ['story must be an object'] };
  }

  if (story.schema_version === undefined) errors.push('schema_version is required but missing');
  if (!story.session) errors.push('session is required but missing');
  if (!Array.isArray(story.turns)) errors.push('turns is required and must be an array');
  if (!Array.isArray(story.files)) errors.push('files is required and must be an array');
  if (!story.totals) errors.push('totals is required but missing');

  if (Array.isArray(story.turns)) {
    story.turns.forEach((turn, ti) => {
      const turnPrefix = `turns[${ti}]`;
      for (const field of REQUIRED_TURN_FIELDS) {
        pushIfMissing(errors, turn, field, turnPrefix);
      }
      if (Array.isArray(turn.edits)) {
        turn.edits.forEach((edit, ei) => {
          const editPrefix = `${turnPrefix}.edits[${ei}]`;
          for (const field of REQUIRED_EDIT_FIELDS) {
            pushIfMissing(errors, edit, field, editPrefix);
          }
        });
      }
      if (turn.duration_source !== undefined && !DURATION_SOURCES.includes(turn.duration_source)) {
        errors.push(`${turnPrefix}.duration_source must be one of: ${DURATION_SOURCES.join(', ')}`);
      }
      if (strict && !turn.summary) {
        errors.push(`${turnPrefix}.summary is required in strict mode but is empty`);
      }
      if (turn.answer !== undefined && turn.answer !== null && typeof turn.answer !== 'string') {
        errors.push(`${turnPrefix}.answer must be a string`);
      } else if (typeof turn.answer === 'string' && turn.answer.length > ANSWER_MAX) {
        errors.push(`${turnPrefix}.answer must be at most ${ANSWER_MAX} characters but is ${turn.answer.length}`);
      }
      if (strict && Array.isArray(turn.replies) && turn.replies.length > 0 && !turn.answer) {
        errors.push(`${turnPrefix}.answer is required in strict mode when the turn has replies, but is empty`);
      }
    });
  }

  // The observability blocks are optional; when present they must be well-formed.
  if (story.trace !== undefined) {
    if (!story.trace || !Array.isArray(story.trace.events)) {
      errors.push('trace.events must be an array');
    } else {
      story.trace.events.forEach((event, i) => {
        const prefix = `trace.events[${i}]`;
        if (typeof event.id !== 'string') errors.push(`${prefix}.id must be a string`);
        if (!EVENT_KINDS.includes(event.kind)) errors.push(`${prefix}.kind must be one of: ${EVENT_KINDS.join(', ')}`);
        if (!EVENT_STATUSES.includes(event.status)) errors.push(`${prefix}.status must be one of: ${EVENT_STATUSES.join(', ')}`);
        if (event.turn !== null && !Number.isInteger(event.turn)) errors.push(`${prefix}.turn must be an integer or null`);
      });
    }
  }
  if (story.metrics !== undefined) {
    for (const group of METRIC_GROUPS) {
      if (!story.metrics || typeof story.metrics[group] !== 'object' || story.metrics[group] === null) {
        errors.push(`metrics.${group} is required when metrics is present`);
      }
    }
    const validation = story.metrics && story.metrics.validation;
    if (validation && !FINAL_STATES.includes(validation.final_state)) {
      errors.push(`metrics.validation.final_state must be one of: ${FINAL_STATES.join(', ')}`);
    }
    const perTurn = story.metrics && story.metrics.turns;
    if (perTurn !== undefined) {
      if (!Array.isArray(perTurn)) {
        errors.push('metrics.turns must be an array');
      } else {
        perTurn.forEach((t, i) => {
          const prefix = `metrics.turns[${i}]`;
          if (!t || !Number.isInteger(t.index)) errors.push(`${prefix}.index must be an integer`);
          if (t && !DURATION_SOURCES.includes(t.duration_source)) {
            errors.push(`${prefix}.duration_source must be one of: ${DURATION_SOURCES.join(', ')}`);
          }
        });
      }
    }
  }

  if (strict && story.session) {
    const { title, summary } = story.session;
    if (!title) {
      errors.push('session.title is required in strict mode but is empty');
    } else if (title.length > TITLE_MAX) {
      errors.push(`session.title must be at most ${TITLE_MAX} characters but is ${title.length}`);
    }
    if (!summary) {
      errors.push('session.summary is required in strict mode but is empty');
    } else if (summary.length > SUMMARY_MAX) {
      errors.push(`session.summary must be at most ${SUMMARY_MAX} characters but is ${summary.length}`);
    }
  }

  if (strict) {
    const report = story.report;
    if (!report || !report.plan) {
      errors.push('report.plan is required in strict mode but is empty');
    }
    if (!report || !OUTCOME_VALUES.includes(report.outcome)) {
      errors.push(`report.outcome is required in strict mode and must be one of: ${OUTCOME_VALUES.join(', ')}`);
    }
    if (!report || !Array.isArray(report.decisions)) {
      errors.push('report.decisions is required in strict mode and must be an array');
    }
  }

  return { valid: errors.length === 0, errors };
}
