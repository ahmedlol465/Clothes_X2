/**
 * Bridge to the AI pipeline (`src/*.ts`).
 *
 * The engine is a large, dependency-light, side-effect-free library that was
 * written for the Express runtime. NestJS reuses it directly.
 */
import * as aiEngine from '../../ai-engine';
import * as llm from '../../llm';
import * as scoring from '../../scoring';
import * as memoryStore from '../../style-memory';
import * as retrieval from '../../retrieval';
import * as weatherEngine from '../../weather';
import * as vision from '../../vision';
import * as taxonomy from '../../taxonomy';

export { aiEngine, llm, scoring, memoryStore, retrieval, weatherEngine, vision, taxonomy };
