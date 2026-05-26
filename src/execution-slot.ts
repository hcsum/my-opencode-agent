interface LeaseState {
  released: boolean;
  done: Promise<void>;
  resolve: () => void;
}

export interface ExecutionLease {
  release(): void;
  wait(): Promise<void>;
}

export class ExecutionSlot {
  private readonly leases = new Map<string, LeaseState>();

  begin(runKey: string): ExecutionLease {
    this.release(runKey);

    let resolve = () => {};
    const state: LeaseState = {
      released: false,
      done: new Promise<void>((done) => {
        resolve = done;
      }),
      resolve: () => {
        if (state.released) return;
        state.released = true;
        this.leases.delete(runKey);
        resolve();
      },
    };

    this.leases.set(runKey, state);

    return {
      release: state.resolve,
      wait: () => state.done,
    };
  }

  release(runKey: string): void {
    this.leases.get(runKey)?.resolve();
  }
}
