export function createMobileTaskListLoadOwnership() {
  let committedLoad: object | null = null
  let generation = 0

  return {
    publish(load: object) {
      committedLoad = load
      generation += 1
    },
    invalidate(load: object) {
      if (committedLoad === load) {
        committedLoad = null
        generation += 1
      }
    },
    owns(load: object) {
      return committedLoad === load
    },
    begin(load: object): (() => boolean) | null {
      if (committedLoad !== load) {
        return null
      }
      const requestGeneration = ++generation
      return () => committedLoad === load && generation === requestGeneration
    }
  }
}
