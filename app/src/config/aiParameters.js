// AI parameter configuration with metadata for UI controls
export const AI_PARAMETERS = {
  // Core generation parameters
  temperature: {
    label: 'Temperature',
    description:
      'Randomness. Lower is more predictable, higher more varied. 1 leaves it to the server.',
    min: 0.0,
    max: 2.0,
    step: 0.1,
    default: 1.0,
  },

  topP: {
    label: 'Top-P',
    description: 'Sample only from the likeliest tokens that add up to P. 1 disables.',
    min: 0.0,
    max: 1.0,
    step: 0.05,
    default: 1.0,
  },

  minP: {
    label: 'Min-P',
    description: 'Drop tokens less than P times as likely as the top one. 0 disables.',
    min: 0.0,
    max: 1.0,
    step: 0.01,
    default: 0,
  },

  topA: {
    label: 'Top-A',
    description: 'Like Min-P, scaled by the square of the top probability. 0 disables.',
    min: 0,
    max: 1.0,
    step: 0.01,
    default: 0,
  },

  topK: {
    label: 'Top-K',
    description: 'Sample only from the K likeliest tokens. 0 disables.',
    min: 0,
    step: 1,
    default: 0,
  },

  // Advanced parameters
  frequencyPenalty: {
    label: 'Frequency Penalty',
    description: 'Penalize tokens by how often they have appeared.',
    min: -2.0,
    max: 2.0,
    step: 0.1,
    default: 0,
  },

  presencePenalty: {
    label: 'Presence Penalty',
    description: 'Penalize tokens that have appeared at all.',
    min: -2.0,
    max: 2.0,
    step: 0.1,
    default: 0,
  },

  repetitionPenalty: {
    label: 'Repetition Penalty',
    description: 'Higher repeats less, but can turn incoherent. 1 disables.',
    min: 0,
    max: 2.0,
    step: 0.05,
    default: 1.0,
  },

  seed: {
    label: 'Seed',
    description: 'Fix it for repeatable output. 0 disables.',
    min: 0,
    max: 2147483647,
    step: 1,
    default: 0,
  },
}
