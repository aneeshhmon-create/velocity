export const createChain = (onFault) => {
  // Stays synchronous until a link returns a promise, so sync handlers don't allocate one per step.
  const run = (links, req, res, done) => {
    let pos = 0;

    const proceed = (error) => {
      if (error) return onFault(error, req, res);
      const link = links[pos++];
      if (!link) return done?.();
      try {
        const out = link(req, res, proceed);
        if (out && typeof out.then === "function") {
          return out.then(undefined, (raised) => onFault(raised, req, res));
        }
        return out;
      } catch (raised) {
        return onFault(raised, req, res);
      }
    };

    return proceed();
  };

  return { run };
};
