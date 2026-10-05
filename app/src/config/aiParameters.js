// AI parameter configuration with metadata for UI controls
export const AI_PARAMETERS = {
  // Core generation parameters
  temperature: {
    label: 'Temperature',
    description:
      'Influences variety in responses by introducing randomness. Lower values are more predictable, higher values are more diverse. 0 is completely deterministic.',
    min: 0.0,
    max: 2.0,
    step: 0.1,
    default: 1.0,
  },

  topP: {
    label: 'Top-P',
    description:
      "Limits the model's choices to the set of top tokens with total probability adding up to P. Set to 1 to disable.",
    min: 0.0,
    max: 1.0,
    step: 0.05,
    default: 1.0,
  },

  minP: {
    label: 'Min-P',
    description:
      "Limits the model's choices based on probability relative to the probability of the top token. A value of 0.5 limits the model to tokens that are at least half as likely as the most probable token.",
    min: 0.0,
    max: 1.0,
    step: 0.01,
    default: 0,
  },

  topA: {
    label: 'Top-A',
    description:
      "Similar to Min-P, but limits the model's choices based on a dynamic, probability-based filtering method. Set to 0 to disable.",
    min: 0,
    max: 1.0,
    step: 0.01,
    default: 0,
  },

  topK: {
    label: 'Top-K',
    description: "Limits the model's choices to the top K tokens. Set to 0 to disable.",
    min: 0,
    step: 1,
    default: 0,
  },

  // Advanced parameters
  frequencyPenalty: {
    label: 'Frequency Penalty',
    description:
      'Controls token repetition based on frequency. Penalty scales with occurrence count.',
    min: -2.0,
    max: 2.0,
    step: 0.1,
    default: 0,
  },

  presencePenalty: {
    label: 'Presence Penalty',
    description:
      'Adjusts likelihood of repeating any tokens that appear in the text. Penalty does not scale with occurrence.',
    min: -2.0,
    max: 2.0,
    step: 0.1,
    default: 0,
  },

  repetitionPenalty: {
    label: 'Repetition Penalty',
    description:
      'Reduces repetition. Higher values result in less repetitive output, but can become incoherent.',
    min: 0,
    max: 2.0,
    step: 0.05,
    default: 1.0,
  },

  seed: {
    label: 'Seed',
    description: 'Set to a positive integer for deterministic (repeatable) outputs. 0 to disable.',
    min: 0,
    max: 2147483647,
    step: 1,
    default: 0,
  },
}
