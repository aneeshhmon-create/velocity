export const createChain = (onFault) => {
  const run = async (links, req, res, done) => {
    let pos = 0;

    const proceed = async (error) => {
      if (error) return onFault(error, req, res);
      const link = links[pos++];
      if (!link) return done?.();
      try {
        await link(req, res, proceed);
      } catch (raised) {
        await onFault(raised, req, res);
      }
    };

    await proceed();
  };

  return { run };
};
