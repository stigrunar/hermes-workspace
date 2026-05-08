export const CONDUCTOR_WORKER_EMOJIS = ['🤖', '⚡', '🛠️', '🌊', '📘', '💫', '🔮', '⭐']

export function getConductorWorkerPersona(index: number) {
  return {
    name: `Worker ${index + 1}`,
    emoji: CONDUCTOR_WORKER_EMOJIS[index % CONDUCTOR_WORKER_EMOJIS.length],
  }
}
