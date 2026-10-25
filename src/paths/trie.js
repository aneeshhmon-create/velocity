import { fault, faultCodes } from "../shared/faults.js";

export const NO_VARS = Object.freeze({});

const makeNode = () => ({ children: new Map(), param: null, wildcard: null, route: null });

const splitPath = (path) => {
  if (path === "" || path === "/") return [];
  return (path[0] === "/" ? path.slice(1) : path).split("/");
};

const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const pair = (labels, captured) => {
  const vars = {};
  labels.forEach((name, i) => {
    vars[name] = captured[i];
  });
  return vars;
};

const finish = (route, captured) => ({
  links: route.links,
  vars: pair(route.labels, captured)
});

const descend = (node, segments, depth, captured) => {
  if (depth === segments.length) {
    if (node.route) return finish(node.route, captured);
    if (node.wildcard) return finish(node.wildcard, captured);
    return null;
  }

  const segment = segments[depth];

  const child = node.children.get(segment);
  if (child) {
    const hit = descend(child, segments, depth + 1, captured);
    if (hit) return hit;
  }

  if (node.param) {
    captured.push(safeDecode(segment));
    const hit = descend(node.param, segments, depth + 1, captured);
    if (hit) return hit;
    captured.pop();
  }

  return node.wildcard ? finish(node.wildcard, captured) : null;
};

export const createTrie = () => {
  const forest = new Map();
  const exact = new Map();

  const reject = (path, reason) =>
    fault(`Invalid route "${path}": ${reason}`, { code: faultCodes.routeInvalid });

  const clash = (method, path) =>
    fault(`Duplicate route: ${method.toUpperCase()} ${path}`, {
      code: faultCodes.routeClash
    });

  // Keyed by upper-case method, the form node hands over in req.method, so lookups skip the case fold.
  const insert = (method, path, links) => {
    const key = method.toUpperCase();
    if (!forest.has(key)) forest.set(key, makeNode());

    const segments = splitPath(path);
    const labels = [];
    let node = forest.get(key);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      if (segment.length > 1 && segment[0] === "*") {
        throw reject(path, 'named wildcards (e.g. "*name") are not supported. Use a plain "*" at the end of the path.');
      }

      if (segment === "*") {
        if (i !== segments.length - 1) throw reject(path, '"*" is only allowed as the final path segment.');
        if (node.wildcard) throw clash(method, path);
        node.wildcard = { links, labels };
        return;
      }

      if (segment[0] === ":") {
        const name = segment.slice(1);
        if (!name) throw reject(path, "empty parameter name.");
        labels.push(name);
        node = node.param ??= makeNode();
        continue;
      }

      if (!node.children.has(segment)) node.children.set(segment, makeNode());
      node = node.children.get(segment);
    }

    if (node.route) throw clash(method, path);
    node.route = { links, labels };

    if (!path.includes(":") && !path.includes("*")) {
      if (!exact.has(key)) exact.set(key, new Map());
      exact.get(key).set(path, { links, vars: NO_VARS });
    }
  };

  const lookup = (method, path) => {
    const key = method;
    const direct = exact.get(key)?.get(path);
    if (direct) return direct;
    const tree = forest.get(key);
    return tree ? descend(tree, splitPath(path), 0, []) : null;
  };

  return { insert, lookup };
};
