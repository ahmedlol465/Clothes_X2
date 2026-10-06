/**
 * Zero-shot classification on top of the fashion CLIP towers (§9 AI PIPELINE).
 *
 * The important part of this file is not the category choice — it is the gate.
 * A photo that is not clothing must come back as `non_clothing` with a reason,
 * never as a garment with a low confidence. So the clothing bank and the
 * non-clothing bank are scored against the same image embedding and the image
 * only passes when clothing wins on two independent measures:
 *
 *   margin  cosine(best clothing centroid) - cosine(best non-clothing centroid)
 *   mass    softmax share of the whole label space held by clothing centroids
 *
 * `margin` is a like-for-like comparison of centroids. `mass` is a
 * whole-label-space comparison and catches the case where no single
 * non-clothing class fits but nothing fits clothing either.
 *
 * The numbers this module reports are cosine similarities and softmax shares
 * over a fixed prompt bank. They are a measure of agreement between the image
 * and this vocabulary, not a calibrated probability of the label being true, and
 * they are labelled as such in the API payload.
 */
'use strict';

const encoder = require('./encoder');
const { GATE } = require('./prompts');

function softmax(values, scale = GATE.logitScale) {
  const scaled = values.map((v) => v * scale);
  const max = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
}

/** Cosine similarity of an image embedding against every centroid in a bank. */
function scoreBank(vec, bank) {
  return bank.map((entry) => ({ entry, sim: encoder.dot(vec, entry.vec) }));
}

/** Rank a bank, highest similarity first. */
function ranked(vec, bank) {
  return scoreBank(vec, bank).sort((a, b) => b.sim - a.sim);
}

/**
 * Which of the top scorers wins, and is it decisive enough to report?
 *
 * Decisiveness is measured on the softmax share, not on the cosine gap. CLIP
 * cosines for a garment sit in a narrow band — two competing classes are often
 * only 0.01 apart out of 0.25 — so a cosine threshold measures nothing useful.
 * The share does: if the runner-up holds a real fraction of the label space,
 * the model saw two readings of the same photo and only one can be reported.
 */
function decide(scored) {
  const [first, second] = scored;
  const p = softmax(scored.map((s) => s.sim));
  const tied = second != null && p[1] >= GATE.tieShare;
  return {
    winner: first.entry,
    winnerSimilarity: first.sim,
    winnerShare: p[0],
    runnerUp: second ? second.entry : null,
    runnerUpSimilarity: second ? second.sim : null,
    runnerUpShare: p[1] != null ? p[1] : 0,
    tie: tied,
    clear: !tied && p[0] >= GATE.attributeFloor,
  };
}

/**
 * Classify one image embedding.
 *
 * @param {Float32Array} vec  unit-length embedding from `encoder.embedImage`
 * @returns {Promise<object>} gate verdict plus every attribute with its evidence
 */
async function classify(vec) {
  const b = await encoder.bank();

  const garments = ranked(vec, b.garments);
  const nonClothing = ranked(vec, b.nonClothing);

  const bestGarment = garments[0].sim;
  const bestNon = nonClothing[0].sim;
  const margin = bestGarment - bestNon;

  const allSims = [...garments.map((g) => g.sim), ...nonClothing.map((n) => n.sim)];
  const allMass = softmax(allSims);
  const clothingMass = allMass
    .slice(0, garments.length)
    .reduce((a, x) => a + x, 0);

  const category = decide(garments);
  const rejected = margin < GATE.clothingMargin || clothingMass < GATE.clothingMass;

  if (rejected) {
    // Report the failing measure, not just "not clothing".
    const reasons = [];
    if (margin < GATE.clothingMargin) {
      reasons.push('best clothing label is not closer than the best non-clothing label');
    }
    if (clothingMass < GATE.clothingMass) {
      reasons.push('clothing labels do not hold enough of the label space');
    }
    return {
      isClothing: false,
      errorType: 'non_clothing',
      reason: reasons.join('; '),
      rejected: {
        margin: Number(margin.toFixed(4)),
        clothingMass: Number(clothingMass.toFixed(4)),
        thresholds: { margin: GATE.clothingMargin, clothingMass: GATE.clothingMass },
        closestGarment: category.winner.subcategory,
        closestGarmentShare: Number(category.winnerShare.toFixed(4)),
        closestNonClothing: nonClothing[0].entry.group,
        closestNonClothingShare: Number(allMass[garments.length].toFixed(4)),
      },
    };
  }

  const style = decide(ranked(vec, b.styles));
  const season = decide(ranked(vec, b.seasons));
  const pattern = decide(ranked(vec, b.patterns));
  const material = decide(ranked(vec, b.materials));

  // Attribute agreement: how much of the label space the winning garment class
  // holds, blended with how far ahead of the runner-up it is. Reported as an
  // agreement score, not a probability.
  const agreement = Number(
    Math.min(1, category.winnerShare * 0.7 + Math.min(1, (category.winnerSimilarity - category.runnerUpSimilarity) * 6) * 0.3).toFixed(4),
  );

  const attr = (d) => ({
    value: d.winner.value,
    share: Number(d.winnerShare.toFixed(4)),
    similarity: Number(d.winnerSimilarity.toFixed(4)),
    runnerUp: d.runnerUp ? d.runnerUp.value : null,
    runnerUpShare: d.runnerUpShare != null ? Number(d.runnerUpShare.toFixed(4)) : 0,
    tied: d.tie,
    confident: d.clear,
  });

  return {
    isClothing: true,
    agreement,
    agreementParts: {
      winnerShare: Number(category.winnerShare.toFixed(4)),
      separation: Number(Math.min(1, (category.winnerSimilarity - category.runnerUpSimilarity) * 6).toFixed(4)),
    },
    gate: {
      margin: Number(margin.toFixed(4)),
      clothingMass: Number(clothingMass.toFixed(4)),
      thresholds: { margin: GATE.clothingMargin, clothingMass: GATE.clothingMass },
      closestNonClothing: nonClothing[0].entry.group,
      closestNonClothingSimilarity: Number(bestNon.toFixed(4)),
    },
    category: category.winner.category,
    subcategory: category.winner.subcategory,
    categoryEvidence: {
      subcategory: category.winner.subcategory,
      share: Number(category.winnerShare.toFixed(4)),
      similarity: Number(category.winnerSimilarity.toFixed(4)),
      runnerUp: category.runnerUp ? category.runnerUp.subcategory : null,
      runnerUpShare: Number(category.runnerUpShare.toFixed(4)),
      tied: category.tie,
      decisive: category.clear,
    },
    style: attr(style),
    season: attr(season),
    pattern: attr(pattern),
    material: attr(material),
  };
}

module.exports = { classify, softmax };