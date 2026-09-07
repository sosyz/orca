export function createInitialPairingUrlConsumer(
  loadInitialUrl: () => Promise<string | null>
): (consume: (url: string) => void) => () => void {
  let initialUrlPromise: Promise<string | null> | null = null
  let delivered = false

  return (consume) => {
    let active = true
    if (!initialUrlPromise) {
      try {
        initialUrlPromise = Promise.resolve(loadInitialUrl()).catch(() => null)
      } catch {
        initialUrlPromise = Promise.resolve(null)
      }
    }
    void initialUrlPromise.then((url) => {
      if (!active || delivered || !url) {
        return
      }
      delivered = true
      consume(url)
    })

    return () => {
      active = false
    }
  }
}
