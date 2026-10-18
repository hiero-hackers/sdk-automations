import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap2 = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar2 = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq2 = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode2(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar2(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap2;
    exports.isNode = isNode2;
    exports.isPair = isPair;
    exports.isScalar = isScalar2;
    exports.isSeq = isSeq2;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path) {
      const ctrl = callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visit_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = visit_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path) {
      const ctrl = await callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visitAsync_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path) {
      if (typeof visitor === "function")
        return visitor(key, node, path);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path);
      return void 0;
    }
    function replaceNode(key, path, node) {
      const parent = path[path.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line2, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line2.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count: count2, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count2);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        if (found && ctx) {
          const { anchors: anchors2, doc: doc2, maxAliasCount } = ctx;
          let data = anchors2.get(found);
          if (!data) {
            toJS.toJS(found, null, ctx);
            data = anchors2.get(found);
          }
          if (data?.res === void 0) {
            const msg = "This should not happen: Alias anchor was not resolved?";
            throw new ReferenceError(msg);
          }
          if (maxAliasCount >= 0) {
            data.count += 1;
            if (data.aliasCount === 0)
              data.aliasCount = getAliasCount(doc2, found, anchors2);
            if (data.count * data.aliasCount > maxAliasCount) {
              const msg = "Excessive alias count indicates a resource exhaustion attack";
              throw new ReferenceError(msg);
            }
          }
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const source = this.resolve(ctx.doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        return ctx.anchors.get(source).res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count2 = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count2)
            count2 = c;
        }
        return count2;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path, value) {
      let v = value;
      for (let i = path.length - 1; i >= 0; --i) {
        const k = path[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path, value) {
        if (isEmptyPath(path))
          this.add(value);
        else {
          const [key, ...rest] = path;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        const [key, ...rest] = path;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent2) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent2 ? comment.replace(/^(?! *$)/gm, indent2) : comment;
    }
    var lineComment = (str, indent2, comment) => str.endsWith("\n") ? indentComment(comment, indent2) : comment.includes("\n") ? "\n" + indentComment(comment, indent2) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text3, indent2, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text3;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent2.length);
      if (text3.length <= endStep)
        return text3;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent2.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text3, i, indent2.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text3[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text3[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text3, i, indent2.length);
          end = i + indent2.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text3[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text3[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text3;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text3;
      if (onFold)
        onFold();
      let res = text3.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold2 = folds[i2];
        const end2 = folds[i2 + 1] || text3.length;
        if (fold2 === 0)
          res = `
${indent2}${text3.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold2])
            res += `${text3[fold2]}\\`;
          res += `
${indent2}${text3.slice(fold2 + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text3, i, indent2) {
      let end = i;
      let start = i + 1;
      let ch = text3[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent2) {
          ch = text3[++i];
        } else {
          do {
            ch = text3[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text3[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent2 = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent2;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent2, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent2 = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent2}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent2, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent2 = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent2.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent2}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent2}`);
      }
      const indentSize = indent2 ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent2}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent2, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent2}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent2}`);
      return `|${header}
${indent2}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent: indent2, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent2 === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent2 === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent2}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent2, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent: indent2, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent2 + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent2}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent: indent2, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line2 = lines[i];
          str += line2 ? `
${indent2}${line2}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent2);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent: indent2, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line2) => sum + line2.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line2) => sum + line2.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line2 of lines)
            str += line2 ? `
${indentStep}${indent2}${line2}` : "\n";
          return `${str}
${indent2}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent: indent2, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent2);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot2 = str.indexOf(".");
        if (dot2 !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot2 - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot2 = str.indexOf(".");
        if (dot2 !== -1) {
          const f = str.substring(dot2 + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp2 = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp2.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp2;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp2 = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp2.intTime,
      timestamp2.floatTime,
      timestamp2.timestamp
    ];
    exports.schema = schema;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp2 = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp2.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp2.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp2.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp2.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        if (Collection.isEmptyPath(path)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        if (Collection.isEmptyPath(path))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path) {
        if (Collection.isEmptyPath(path))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        if (Collection.isEmptyPath(path)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count: count2, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count2);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line: line2, col } = error.linePos[0];
      error.message += ` at line ${line2}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line2 - 1], lc.lineStarts[line2]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line2 > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line2 - 2], lc.lineStarts[line2 - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count2 = 1;
        const end = error.linePos[1];
        if (end?.line === line2 && end.col > col) {
          count2 = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count2);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent2, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent2 && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap2 = fc.start.source === "{";
      const fcName = isMap2 ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap2 ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap2 && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap2 && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap2 && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap2) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap2 ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar2, onError) {
      const start = scalar2.offset;
      const header = parseBlockScalarHeader(scalar2, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar2.source ? splitLines(scalar2.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar2.source)
          end2 += scalar2.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar2.indent + header.indent;
      let offset = scalar2.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent2, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent2.length > trimIndent)
            trimIndent = indent2.length;
        } else {
          if (indent2.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent2.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent2.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent2.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent2, content] = lines[i];
        offset += indent2.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent2.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent2 = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent2.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent2.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent2.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar2.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent2 = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent2 && n)
            indent2 = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent: indent2, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar2, strict, onError) {
      const { offset, type, source, end } = scalar2;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar2, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return unfoldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function unfoldLines(source) {
      const line2 = /(.*?)\r?\n/sy;
      let match = line2.exec(source);
      if (!match)
        return source;
      let trimEnd, trimBoth;
      try {
        trimEnd = new RegExp("(?<![ 	])[ 	]+$");
        trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
      } catch {
        trimEnd = /[ \t]+$/;
        trimBoth = /^[ \t]+|[ \t]+$/g;
      }
      let res = match[1].replace(trimEnd, "");
      let sep = " ";
      let pos = line2.lastIndex;
      while (match = line2.exec(source)) {
        const lm = match[1].replace(trimBoth, "");
        if (lm === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + lm;
          sep = " ";
        }
        pos = line2.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold: fold2, offset } = foldNewline(source, i);
          res += fold2;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold2 = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold2 += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold2)
        fold2 = " ";
      return { fold: fold2, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar2;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar2 = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar2 = new Scalar.Scalar(value);
      }
      scalar2.range = range;
      scalar2.source = value;
      if (type)
        scalar2.type = type;
      if (tagName)
        scalar2.tag = tagName;
      if (tag.format)
        scalar2.format = tag.format;
      if (comment)
        scalar2.comment = comment;
      return scalar2;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent: indent2, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent2 > 0 ? " ".repeat(indent2) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent: indent2, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent: indent2, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent: indent2, source: "\n" });
          return { type: "block-scalar", offset, indent: indent2, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent: indent2, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent: indent2, source, end };
        default:
          return { type: "scalar", offset, indent: indent2, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent2 = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent2 === "number")
        indent2 += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent2 === null,
        indent: indent2 !== null && indent2 > 0 ? " ".repeat(indent2) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent2 = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent: indent2, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent: indent2, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent: indent2, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent2 = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent: indent2, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path) => {
      let item = cst;
      for (const [field2, index] of path) {
        const tok = item?.[field2];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path) => {
      const parent = visit.itemAtPath(cst, path.slice(0, -1));
      const field2 = path[path.length - 1][0];
      const coll = parent?.[field2];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path, item, visitor) {
      let ctrl = visitor(item, path);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field2 of ["key", "value"]) {
        const token = item[field2];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path.concat([[field2, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field2 === "key")
            ctrl = ctrl(item, path);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
    }
    exports.visit = visit;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar2 = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar2;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent2 = 0;
          while (ch === " ")
            ch = this.buffer[++indent2 + offset];
          if (ch === "\r") {
            const next = this.buffer[indent2 + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent2 + 1;
          }
          return ch === "\n" || indent2 >= this.indentNext || !ch && !this.atEnd ? offset + indent2 : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line2 = this.getLine();
        if (line2 === null)
          return this.setNext("stream");
        if (line2[0] === cst.BOM) {
          yield* this.pushCount(1);
          line2 = line2.substring(1);
        }
        if (line2[0] === "%") {
          let dirEnd = line2.length;
          let cs = line2.indexOf("#");
          while (cs !== -1) {
            const ch = line2[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line2.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line2[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line2.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line2.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line2 = this.getLine();
        if (line2 === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line2[n]) {
          case "#":
            yield* this.pushCount(line2.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line2.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent2 = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent2 = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line2 = this.getLine();
        if (line2 === null)
          return this.setNext("flow");
        if (indent2 !== -1 && indent2 < this.indentNext && line2[0] !== "#" || indent2 === 0 && (line2.startsWith("---") || line2.startsWith("...")) && isEmpty(line2[3])) {
          const atFlowEndMarker = indent2 === this.indentNext - 1 && this.flowLevel === 1 && (line2[0] === "]" || line2[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line2[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line2[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line2.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent2 = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent2 += 1;
              break;
            case "\n":
              nl = i2;
              indent2 = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent2 >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent2;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent2 > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter2 = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter2;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar2) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar2.end) {
            sep = scalar2.end;
            sep.push(this.sourceToken);
            delete scalar2.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar2.offset,
            indent: scalar2.indent,
            items: [{ start, key: scalar2, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar2);
      }
      *blockScalar(scalar2) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar2.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar2.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent2) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent2)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument2(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument2(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent2 = Math.round(options);
        options = indent2 < 1 ? void 0 : indent2 > 8 ? { indent: 8 } : { indent: indent2 };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument2;
    exports.stringify = stringify;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// src/shell/compose/action/main.ts
import { readFileSync as readFileSync2 } from "node:fs";

// src/shell/observe/summary.ts
import { appendFileSync } from "node:fs";

// src/store/fold.ts
var broken = (detail) => ({ kind: "inconsistent", detail });
var effectLevel = (kind) => kind === "warned" || kind === "reversed";
function gapBefore(seq, landed2) {
  for (let earlier = 1; earlier < seq; earlier += 1) {
    if (!landed2.has(earlier)) return earlier;
  }
  return null;
}
function fold(facts, planLength) {
  const landed2 = /* @__PURE__ */ new Set();
  const attempts = /* @__PURE__ */ new Map();
  let open = null;
  let settled2 = null;
  let anyCall = false;
  for (const fact of facts) {
    if (effectLevel(fact.kind)) continue;
    anyCall = true;
    if (settled2 !== null) return broken(`a ${fact.kind} arrived after the effect settled`);
    if (fact.seq < 1 || fact.seq > planLength) {
      return broken(`seq ${String(fact.seq)} is outside the plan's ${String(planLength)}`);
    }
    if (fact.kind === "sent") {
      if (open !== null && open.seq !== fact.seq) {
        return broken(
          `a send at seq ${String(fact.seq)} while seq ${String(open.seq)} was open`
        );
      }
      const gap = gapBefore(fact.seq, landed2);
      if (gap !== null) {
        return broken(`seq ${String(fact.seq)} sent with seq ${String(gap)} unlanded`);
      }
      open = fact;
      attempts.set(fact.seq, (attempts.get(fact.seq) ?? 0) + 1);
      continue;
    }
    if (open === null || open.seq !== fact.seq) {
      return broken(`a ${fact.kind} at seq ${String(fact.seq)} closes no open send`);
    }
    open = null;
    if (fact.kind === "landed") {
      landed2.add(fact.seq);
      if (fact.seq === planLength) {
        settled2 = { kind: "settled", how: "landed", seq: fact.seq };
      }
      continue;
    }
    if (fact.kind === "unsent") {
      attempts.set(fact.seq, attempts.get(fact.seq) - 1);
    } else {
      settled2 = { kind: "settled", how: fact.kind, seq: fact.seq };
    }
  }
  if (settled2 !== null) return settled2;
  if (open !== null) {
    const spent = attempts.get(open.seq);
    return { kind: "open", seq: open.seq, payload: open.payload, attempts: spent };
  }
  if (!anyCall) return { kind: "neverStarted" };
  return { kind: "resumable", nextSeq: landed2.size + 1 };
}

// src/store/guards.ts
function assertUtcInstant(value, param) {
  const epochMs = Date.parse(value);
  if (value.length !== 24 || !Number.isFinite(epochMs) || new Date(epochMs).toISOString() !== value) {
    throw new TypeError(
      `${param} must be a millisecond-precision UTC instant, exactly Date.toISOString() form (got ${JSON.stringify(value)})`
    );
  }
}
function assertNonEmpty(value, param) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${param} must be a non-empty string`);
  }
}

// src/store/inbox.ts
import { createHash as createHash3 } from "node:crypto";

// ../core/src/config/spec.ts
function dot(path, key) {
  return path === "" ? key : `${path}.${key}`;
}
function problem(path, message) {
  return { ok: false, problems: [{ code: "settingInvalid", path, message }] };
}
function readScope(fields, scope) {
  const problems = [];
  const read = [];
  for (const [key, field2] of Object.entries(fields)) {
    const one = field2.read(key, scope);
    if (one.ok) read.push([key, one.value]);
    else problems.push(...one.problems);
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: Object.fromEntries(read) };
}
function readSettings(fields, view, raw) {
  const own = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of Object.entries(raw)) own[key] = value;
  return readScope(fields, {
    raw: own,
    path: "",
    fields,
    outer: null,
    view: { mapped: view.mapped, principals: view.principals }
  });
}
function describeSpec(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, field2]) => [key, field2.describe()])
  );
}

// ../core/src/config/schema.ts
var REPOSITORY_MODES = ["disabled", "observe", "dry-run", "active"];
var ENTITY_KINDS = ["issue", "pullRequest"];
var MEANING_FACTS = {
  awaitingTriage: { flow: "issue" },
  ready: { flow: "issue" },
  inProgress: { flow: "issue" },
  needsReview: { flow: "pullRequest" },
  needsRevision: { flow: "pullRequest" },
  readyToMerge: { flow: "pullRequest" },
  blocked: { flow: "pause" }
};
var MAPPABLE_MEANINGS = Object.keys(MEANING_FACTS);
var COMMANDS = ["assign", "unassign", "working"];
var SKILL_TIERS = ["goodFirstIssue", "beginner", "intermediate", "advanced"];
var CAPABILITY_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
var MAPPING_FAMILIES = [
  "labels",
  "commands",
  "skills"
];
var OPEN_MAPPING_FAMILIES = ["alerts"];
var MAPPING_SECTION_KEYS = [
  ...MAPPING_FAMILIES,
  ...OPEN_MAPPING_FAMILIES
];
var TOP_LEVEL_KEYS = [
  "schemaVersion",
  "mode",
  "capabilities",
  "mappings",
  "principals"
];

// ../core/src/config/source.ts
import { createHash } from "node:crypto";
var CONFIG_PATH = "sdk-automations.yml";
var ABSENT_CONFIG_REVISION = "sha256:absent";
var UNREADABLE_CONFIG_REVISION = "sha256:unreadable";
function revisionOf(text3) {
  return `sha256:${createHash("sha256").update(text3).digest("hex").slice(0, 12)}`;
}

// ../core/src/config/label-defaults.ts
var LABEL_DEFAULTS = {
  awaitingTriage: {
    name: "status: triage",
    color: "fbca04",
    description: "New; waiting for a maintainer to triage"
  },
  ready: {
    name: "status: ready",
    color: "0e8a16",
    description: "Triaged and ready to be picked up"
  },
  inProgress: {
    name: "status: in progress",
    color: "1d76db",
    description: "Someone is working on it"
  },
  needsReview: {
    name: "status: needs review",
    color: "5319e7",
    description: "Waiting for a maintainer's review"
  },
  needsRevision: {
    name: "status: needs revision",
    color: "d93f0b",
    description: "Changes are needed before review"
  },
  readyToMerge: {
    name: "status: ready to merge",
    color: "006b75",
    description: "Approved and waiting to merge"
  },
  blocked: {
    name: "status: blocked",
    color: "b60205",
    description: "Paused by a person; every clock waits"
  }
};
var DEFAULT_LABEL_MAPPINGS = Object.fromEntries(
  Object.entries(LABEL_DEFAULTS).map(([meaning, label]) => [meaning, label.name])
);

// ../core/src/config/results.ts
function err(code, message, path = null) {
  return { code, message, path };
}
function checked(value, errors) {
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

// ../core/src/config/labels.ts
function labelKey(label) {
  return label.trim().toLowerCase();
}
function carriedOf(family, mapped, labels) {
  const carried = new Set(labels.map(labelKey));
  return family.filter((member) => {
    const label = mapped[member];
    return label !== void 0 && carried.has(labelKey(label));
  });
}
function meaningsOfLabels(config, labels) {
  return carriedOf(MAPPABLE_MEANINGS, config.mappings.labels, labels);
}
function skillsOfLabels(config, labels) {
  return carriedOf(SKILL_TIERS, config.mappings.skills, labels);
}

// ../core/src/config/sections.ts
function isPlainObject(v) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const prototype = Object.getPrototypeOf(v);
  return prototype === Object.prototype || prototype === null;
}
var KNOWN_TOP_LEVEL = new Set(TOP_LEVEL_KEYS);
function checkTopLevelKeys(raw) {
  return Object.keys(raw).filter((key) => !KNOWN_TOP_LEVEL.has(key)).map(
    (key) => err(
      "unknownKey",
      `unknown key "${key}" (unknown keys are rejected, config-schema.md \xA73)`,
      key
    )
  );
}
function checkSchemaVersion(raw) {
  if (!Object.hasOwn(raw, "schemaVersion") || raw.schemaVersion === 2) return [];
  return [
    err(
      "schemaVersionUnsupported",
      `schemaVersion, when stated, must be the number 2, got ${JSON.stringify(raw.schemaVersion)}`,
      "schemaVersion"
    )
  ];
}
function isRepositoryMode(value) {
  return typeof value === "string" && REPOSITORY_MODES.includes(value);
}
function readMode(raw) {
  const value = Object.hasOwn(raw, "mode") ? raw.mode : "observe";
  return isRepositoryMode(value) ? { ok: true, value } : {
    ok: false,
    errors: [
      err(
        "modeInvalid",
        `mode must be one of ${REPOSITORY_MODES.join(", ")}, got ${JSON.stringify(raw.mode)}`,
        "mode"
      )
    ]
  };
}
function admissionsOf(known) {
  const admitted = /* @__PURE__ */ new Map();
  for (const entry of known) admitted.set(entry.name, entry);
  return admitted;
}
function readCapabilitySettings(capability, admitted, names, stated, base) {
  const at2 = (path) => `${base}.${path}`;
  const declares = Object.keys(admitted.settings);
  const errors = Object.keys(stated).filter((key) => !declares.includes(key)).map(
    (key) => err(
      "unknownKey",
      `capability "${capability}": unknown setting "${key}" (it declares: ${[...declares].sort().join(", ") || "no settings"})`,
      at2(key)
    )
  );
  if (names === null) return checked(stated, errors);
  const read = readSettings(admitted.settings, names, stated);
  if (read.ok) return checked(read.value, errors);
  return {
    ok: false,
    errors: [
      ...errors,
      ...read.problems.map(
        (problem2) => err(problem2.code, `${at2(problem2.path)}: ${problem2.message}`, at2(problem2.path))
      )
    ]
  };
}
function readCapabilities(raw, knownCapabilities, names) {
  const entries = [];
  const errors = [];
  if (raw.capabilities === void 0) return { ok: true, value: entries };
  if (!isPlainObject(raw.capabilities)) {
    return {
      ok: false,
      errors: [err("notAMapping", "capabilities must be a mapping", "capabilities")]
    };
  }
  const admitted = admissionsOf(knownCapabilities);
  for (const [name, value] of Object.entries(raw.capabilities)) {
    if (!CAPABILITY_NAME_PATTERN.test(name)) {
      errors.push(
        err(
          "capabilityNameInvalid",
          `capability name ${JSON.stringify(name)} is not a valid configuration key (camelCase)`,
          `capabilities.${name}`
        )
      );
      continue;
    }
    if (!isPlainObject(value)) {
      errors.push(
        err(
          "notAMapping",
          `capability "${name}" must be a mapping`,
          `capabilities.${name}`
        )
      );
      continue;
    }
    if (value.enabled !== void 0 && typeof value.enabled !== "boolean") {
      errors.push(
        err(
          "capabilityEnabledNotBoolean",
          `capability "${name}": enabled must be a boolean`,
          `capabilities.${name}.enabled`
        )
      );
    }
    const enabled = value.enabled === true;
    if (!admitted.has(name)) {
      errors.push(
        err(
          "capabilityUnknown",
          `capability "${name}" is not available in this application (available: ${[...admitted.keys()].sort().join(", ") || "none"})`,
          `capabilities.${name}`
        )
      );
    }
    const declared = admitted.get(name);
    const stated = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "enabled")
    );
    const read = declared === void 0 ? null : readCapabilitySettings(name, declared, names, stated, `capabilities.${name}`);
    if (read !== null && !read.ok) errors.push(...read.errors);
    const labels = declared?.labels ?? [];
    entries.push([
      name,
      {
        enabled,
        settings: read?.ok === true ? read.value : stated,
        ...labels.length === 0 ? {} : { labels }
      }
    ]);
  }
  return checked(entries, errors);
}
function unadmittedKey(spec2, meaning) {
  const at2 = `${spec2.path}.${meaning}`;
  if (spec2.meanings === null) {
    return CAPABILITY_NAME_PATTERN.test(meaning) ? null : err(
      spec2.notMappable,
      `${spec2.path}: ${JSON.stringify(meaning)} is not a valid name (camelCase)`,
      at2
    );
  }
  return spec2.meanings.includes(meaning) ? null : err(spec2.notMappable, `${spec2.path}: "${meaning}" is not a mappable meaning`, at2);
}
function readMeaningFamily(spec2, rawFamily) {
  const family = {};
  const errors = [];
  const owner = /* @__PURE__ */ new Map();
  for (const [meaning, spelling] of Object.entries(rawFamily)) {
    const unadmitted = unadmittedKey(spec2, meaning);
    if (unadmitted !== null) {
      errors.push(unadmitted);
      continue;
    }
    if (typeof spelling !== "string" || spelling.trim() === "") {
      errors.push(
        err(
          spec2.invalid,
          `${spec2.path}.${meaning}: ${spec2.noun} must be a non-empty string`,
          `${spec2.path}.${meaning}`
        )
      );
      continue;
    }
    if (spec2.wellFormed !== void 0 && !spec2.wellFormed.holds(spelling)) {
      errors.push(
        err(
          spec2.invalid,
          `${spec2.path}.${meaning}: ${spec2.noun} ${spec2.wellFormed.must}`,
          `${spec2.path}.${meaning}`
        )
      );
      continue;
    }
    const key = spec2.fold(spelling);
    const held2 = owner.get(key);
    if (held2 !== void 0) {
      errors.push(
        err(
          spec2.notInjective,
          `${spec2.path}: ${spec2.noun} ${JSON.stringify(spelling)} is mapped to both "${held2.meaning}" and "${meaning}"` + (held2.spelling === spelling ? "" : spec2.collisionNote(held2.spelling)) + ` \u2014 ${spec2.noun} mappings must be injective (config-schema.md \xA73)`,
          `${spec2.path}.${meaning}`
        )
      );
      continue;
    }
    owner.set(key, { meaning, spelling });
    family[meaning] = spelling;
  }
  return checked(family, errors);
}
var LABELS = {
  path: "mappings.labels",
  noun: "label",
  meanings: MAPPABLE_MEANINGS,
  fold: labelKey,
  collisionNote: (other) => ` (differing only in case or surrounding space from ${JSON.stringify(other)}, which GitHub treats as the same label)`,
  notMappable: "meaningNotMappable",
  invalid: "labelInvalid",
  notInjective: "labelNotInjective"
};
var COMMAND_WORDS = {
  path: "mappings.commands",
  noun: "command",
  meanings: COMMANDS,
  fold: labelKey,
  collisionNote: (other) => ` (differing only in case or surrounding space from ${JSON.stringify(other)}, which a contributor types the same way)`,
  wellFormed: {
    holds: (spelling) => spelling.trim().startsWith("/"),
    must: 'must start with "/"'
  },
  notMappable: "commandNotMappable",
  invalid: "commandInvalid",
  notInjective: "commandNotInjective"
};
var SKILLS = {
  path: "mappings.skills",
  noun: "label",
  meanings: SKILL_TIERS,
  fold: labelKey,
  collisionNote: LABELS.collisionNote,
  notMappable: "skillNotMappable",
  invalid: "skillInvalid",
  notInjective: "skillNotInjective"
};
var ALERTS = {
  path: "mappings.alerts",
  noun: "label",
  meanings: null,
  fold: labelKey,
  collisionNote: LABELS.collisionNote,
  notMappable: "alertInvalid",
  invalid: "alertInvalid",
  notInjective: "alertNotInjective"
};
function readFamily(spec2, raw) {
  const family = raw ?? {};
  if (!isPlainObject(family)) {
    return {
      ok: false,
      errors: [err("notAMapping", `${spec2.path} must be a mapping`, spec2.path)]
    };
  }
  return readMeaningFamily(spec2, family);
}
function labelsTaken(families) {
  const taken = /* @__PURE__ */ new Map();
  for (const [family, mapped] of families) {
    for (const [meaning, label] of Object.entries(mapped)) {
      taken.set(labelKey(label), `"${meaning}" under mappings.${family}`);
    }
  }
  return taken;
}
function checkAgainstEarlier(spec2, taken, entries) {
  const errors = [];
  for (const [name, spelling] of Object.entries(entries)) {
    const held2 = taken.get(labelKey(spelling));
    if (held2 === void 0) continue;
    errors.push(
      err(
        spec2.notInjective,
        `${spec2.path}.${name}: label ${JSON.stringify(spelling)} is already mapped to ${held2} \u2014 one label cannot carry two meanings (config-schema.md \xA73)`,
        `${spec2.path}.${name}`
      )
    );
  }
  return errors;
}
function labelsWithDefaults(mapped) {
  const errors = [];
  const merged = { ...DEFAULT_LABEL_MAPPINGS };
  for (const [meaning, spelling] of Object.entries(mapped)) {
    merged[meaning] = spelling;
  }
  for (const [meaning, spelling] of Object.entries(mapped)) {
    const shadowed = MAPPABLE_MEANINGS.find(
      (other) => other !== meaning && !Object.hasOwn(mapped, other) && labelKey(DEFAULT_LABEL_MAPPINGS[other]) === labelKey(spelling)
    );
    if (shadowed === void 0) continue;
    errors.push(
      err(
        LABELS.notInjective,
        `mappings.labels.${meaning}: label ${JSON.stringify(spelling)} is the default spelling of "${shadowed}" \u2014 map ${shadowed} to another label, or spell ${meaning} differently (D203)`,
        `mappings.labels.${meaning}`
      )
    );
  }
  return checked(merged, errors);
}
function readMappings(raw) {
  if (raw.mappings === void 0) {
    return {
      ok: true,
      value: { labels: { ...DEFAULT_LABEL_MAPPINGS }, commands: {}, skills: {}, alerts: {} }
    };
  }
  if (!isPlainObject(raw.mappings)) {
    return {
      ok: false,
      errors: [err("notAMapping", "mappings must be a mapping", "mappings")]
    };
  }
  const section2 = raw.mappings;
  const errors = Object.keys(section2).filter((key) => !MAPPING_SECTION_KEYS.includes(key)).map((key) => err("unknownKey", `mappings: unknown key "${key}"`, `mappings.${key}`));
  const written = readFamily(LABELS, section2.labels);
  const labels = written.ok ? labelsWithDefaults(written.value) : written;
  const commands = readFamily(COMMAND_WORDS, section2.commands);
  const skills3 = readFamily(SKILLS, section2.skills);
  const alerts = readFamily(ALERTS, section2.alerts);
  if (!labels.ok || !commands.ok || !skills3.ok || !alerts.ok) {
    return {
      ok: false,
      errors: [
        ...errors,
        ...labels.ok ? [] : labels.errors,
        ...commands.ok ? [] : commands.errors,
        ...skills3.ok ? [] : skills3.errors,
        ...alerts.ok ? [] : alerts.errors
      ]
    };
  }
  const mapped = alerts.value;
  const shared = [
    ...checkAgainstEarlier(SKILLS, labelsTaken([["labels", labels.value]]), skills3.value),
    ...checkAgainstEarlier(
      ALERTS,
      labelsTaken([
        ["labels", labels.value],
        ["skills", skills3.value]
      ]),
      mapped
    )
  ];
  return checked(
    {
      labels: labels.value,
      commands: commands.value,
      skills: skills3.value,
      alerts: mapped
    },
    [...errors, ...shared]
  );
}
function readPrincipals(raw) {
  const entries = [];
  const errors = [];
  if (raw.principals === void 0) return { ok: true, value: entries };
  if (!isPlainObject(raw.principals)) {
    return {
      ok: false,
      errors: [err("notAMapping", "principals must be a mapping", "principals")]
    };
  }
  for (const [key, value] of Object.entries(raw.principals)) {
    if (!CAPABILITY_NAME_PATTERN.test(key)) {
      errors.push(
        err(
          "principalNameInvalid",
          `principals: ${JSON.stringify(key)} is not a valid name (camelCase)`,
          `principals.${key}`
        )
      );
      continue;
    }
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(
        err(
          "principalNotAString",
          `principals.${key}: must be a non-empty string`,
          `principals.${key}`
        )
      );
      continue;
    }
    entries.push([key, value]);
  }
  return checked(entries, errors);
}
function checkRequiredMappings(capabilities2, mappings2, knownCapabilities) {
  const admitted = admissionsOf(knownCapabilities);
  const errors = [];
  for (const [name, block2] of capabilities2) {
    const declared = admitted.get(name);
    if (!block2.enabled || declared === void 0) continue;
    for (const family of MAPPING_FAMILIES) {
      for (const meaning of declared.requiredMappings[family] ?? []) {
        if (Object.hasOwn(mappings2[family], meaning)) continue;
        errors.push(
          err(
            "meaningRequired",
            `capability "${name}" is enabled but requires the meaning "${meaning}", which this repository has not mapped \u2014 add mappings.${family}.${meaning}, or set capabilities.${name}.enabled to false`,
            `mappings.${family}.${meaning}`
          )
        );
      }
    }
  }
  return errors;
}

// ../core/src/config/parse.ts
function cleanRecord(entries) {
  const record2 = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of entries) record2[key] = value;
  return record2;
}
var NO_CONFIG = {
  revision: "",
  schemaVersion: 2,
  mode: "observe",
  capabilities: cleanRecord([]),
  mappings: { labels: { ...DEFAULT_LABEL_MAPPINGS }, commands: {}, skills: {}, alerts: {} },
  principals: cleanRecord([])
};
function namesIn(mappings2, principals2) {
  if (!mappings2.ok || !principals2.ok) return null;
  const mapped = mappings2.value;
  return {
    mapped: {
      labels: Object.keys(mapped.labels),
      commands: Object.keys(mapped.commands),
      skills: Object.keys(mapped.skills),
      alerts: Object.keys(mapped.alerts)
    },
    principals: principals2.value.map(([name]) => name)
  };
}
function parseConfig(raw, options) {
  if (raw === void 0 || raw === null) {
    return { ok: true, config: { ...NO_CONFIG, revision: options.revision } };
  }
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [err("notAMapping", "configuration must be a mapping", null)]
    };
  }
  const mode = readMode(raw);
  const mappings2 = readMappings(raw);
  const principals2 = readPrincipals(raw);
  const capabilities2 = readCapabilities(
    raw,
    options.knownCapabilities,
    namesIn(mappings2, principals2)
  );
  const structural = [...checkTopLevelKeys(raw), ...checkSchemaVersion(raw)];
  const unmet = capabilities2.ok && mappings2.ok ? checkRequiredMappings(capabilities2.value, mappings2.value, options.knownCapabilities) : [];
  if (!mode.ok || !capabilities2.ok || !mappings2.ok || !principals2.ok) {
    return {
      ok: false,
      errors: [
        ...structural,
        ...mode.ok ? [] : mode.errors,
        ...capabilities2.ok ? [] : capabilities2.errors,
        ...mappings2.ok ? [] : mappings2.errors,
        ...principals2.ok ? [] : principals2.errors,
        ...unmet
      ]
    };
  }
  if (structural.length > 0 || unmet.length > 0) {
    return { ok: false, errors: [...structural, ...unmet] };
  }
  return {
    ok: true,
    config: {
      revision: options.revision,
      schemaVersion: 2,
      mode: mode.value,
      capabilities: cleanRecord(capabilities2.value),
      mappings: mappings2.value,
      principals: cleanRecord(principals2.value)
    }
  };
}

// ../core/src/config/document.ts
var import_yaml = __toESM(require_dist(), 1);
var MAX_ALIAS_COUNT = 10;
function refersToItself(value, ancestors) {
  if (typeof value !== "object" || value === null) return false;
  if (ancestors.has(value)) return true;
  ancestors.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  const found = children.some((child) => refersToItself(child, ancestors));
  ancestors.delete(value);
  return found;
}
function documentError(error) {
  return error.code === "DUPLICATE_KEY" ? err(
    "duplicateKey",
    `${error.message}
YAML keeps the LAST value, so the earlier one is silently discarded.`,
    null
  ) : err("documentUnparseable", error.message, null);
}
var SEQUENCE_INDEX = /^\d+$/;
function childOf(node, segment) {
  if ((0, import_yaml.isMap)(node)) {
    for (const pair of node.items) {
      if ((0, import_yaml.isScalar)(pair.key) && String(pair.key.value) === segment) {
        return { at: pair.key, under: pair.value };
      }
    }
    return null;
  }
  if ((0, import_yaml.isSeq)(node) && SEQUENCE_INDEX.test(segment)) {
    const item = node.items[Number(segment)];
    return (0, import_yaml.isNode)(item) ? { at: item, under: item } : null;
  }
  return null;
}
function nodeAtPath(contents, path) {
  let node = contents;
  let deepest = null;
  for (const segment of path.split(".")) {
    const reached = childOf(node, segment);
    if (reached === null) break;
    deepest = reached.at;
    node = reached.under;
  }
  return deepest;
}
function lineOf(node, lines) {
  const range = node === null ? null : node.range;
  return range ? lines.linePos(range[0]).line : void 0;
}
function withLine(error, contents, lines) {
  if (error.path === null) return error;
  const line2 = lineOf(nodeAtPath(contents, error.path), lines);
  return line2 === void 0 ? error : { ...error, line: line2 };
}
function parseConfigDocument(text3, options) {
  const lines = new import_yaml.LineCounter();
  const document = (0, import_yaml.parseDocument)(text3, { lineCounter: lines });
  if (document.errors.length > 0) {
    return { ok: false, errors: document.errors.map(documentError) };
  }
  let value;
  try {
    value = document.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch (_cause) {
    return {
      ok: false,
      errors: [
        err(
          "documentUnparseable",
          `the document expands to more than ${MAX_ALIAS_COUNT} YAML aliases and was not read; a repository configuration has no legitimate use for anchors at that scale`,
          null
        )
      ]
    };
  }
  if (refersToItself(value, /* @__PURE__ */ new Set())) {
    return {
      ok: false,
      errors: [
        err(
          "documentUnparseable",
          "the document refers to itself through a YAML alias and was not read",
          null
        )
      ]
    };
  }
  const result = parseConfig(value, options);
  if (result.ok) return result;
  return {
    ok: false,
    errors: result.errors.map((error) => withLine(error, document.contents, lines))
  };
}

// ../core/src/config/commands.ts
function fenceOf(line2) {
  const trimmed = line2.trim();
  if (trimmed.startsWith("```")) return "```";
  return trimmed.startsWith("~~~") ? "~~~" : null;
}
function linesOutsideFences(body) {
  const outside = [];
  let open = null;
  for (const line2 of body.split("\n")) {
    const marker = fenceOf(line2);
    if (open === null) {
      if (marker === null) outside.push(line2);
      else open = marker;
    } else if (marker === open) {
      open = null;
    }
  }
  return outside;
}
var INDENTED_CODE = /^(?: {4}| {0,3}\t)/;
function commandInComment(config, body) {
  for (const line2 of linesOutsideFences(body)) {
    if (INDENTED_CODE.test(line2)) continue;
    const first = labelKey(line2).split(/\s+/)[0];
    if (first === void 0 || first === "") continue;
    for (const command4 of COMMANDS) {
      const spelling = config.mappings.commands[command4];
      if (spelling !== void 0 && labelKey(spelling) === first) return command4;
    }
  }
  return null;
}

// ../core/src/workflow/positions.ts
function isIssueMeaning(m) {
  return MEANING_FACTS[m].flow === "issue";
}
function isPrMeaning(m) {
  return MEANING_FACTS[m].flow === "pullRequest";
}
var ISSUE_MEANINGS = MAPPABLE_MEANINGS.filter(isIssueMeaning);
var PR_MEANINGS = MAPPABLE_MEANINGS.filter(isPrMeaning);

// ../core/src/workflow/causes.ts
var ISSUE_CAUSES = [
  "intakeObserved",
  // [*] → awaitingTriage
  "triageCompleted",
  // awaitingTriage → ready
  "contributorAssigned",
  // ready → inProgress
  "lastContributorUnassigned",
  // inProgress → ready
  "reclaimCompleted",
  // inProgress → ready (approved reclaim)
  "humanClosed",
  // any → closed
  "linkedMergeClosed"
  // any → closed, because a linked PR merged
];
var PR_CAUSES = [
  "checksPassed",
  // [*] → needsReview
  "checksFailed",
  // [*] / needsReview / readyToMerge → needsRevision
  "revisionResolved",
  // needsRevision → needsReview
  "reviewRequestedChanges",
  // needsReview → needsRevision
  "reviewPolicySatisfied",
  // needsReview → readyToMerge
  "approvalInvalidated",
  // readyToMerge → needsReview
  "humanClosed",
  // any → closed, unmerged
  "merged"
  // any → closed, merged
];
function isIssueCause(c) {
  return ISSUE_CAUSES.some((x) => x === c);
}
function isPrCause(c) {
  return PR_CAUSES.some((x) => x === c);
}

// ../core/src/workflow/state.ts
function isBlocked(meanings2) {
  return meanings2.includes("blocked");
}

// ../core/src/workflow/transitions.ts
var ISSUE_EDGES = [
  { from: null, to: "awaitingTriage", causes: ["intakeObserved"] },
  { from: "awaitingTriage", to: "ready", causes: ["triageCompleted"] },
  { from: "ready", to: "inProgress", causes: ["contributorAssigned"] },
  {
    from: "inProgress",
    to: "ready",
    causes: ["lastContributorUnassigned", "reclaimCompleted"]
  },
  { from: "awaitingTriage", to: null, causes: ["humanClosed"] },
  { from: "ready", to: null, causes: ["humanClosed", "linkedMergeClosed"] },
  { from: "inProgress", to: null, causes: ["humanClosed", "linkedMergeClosed"] }
];
var PR_EDGES = [
  { from: null, to: "needsReview", causes: ["checksPassed"] },
  { from: null, to: "needsRevision", causes: ["checksFailed"] },
  {
    from: "needsReview",
    to: "needsRevision",
    causes: ["checksFailed", "reviewRequestedChanges"]
  },
  { from: "needsRevision", to: "needsReview", causes: ["revisionResolved"] },
  { from: "needsReview", to: "readyToMerge", causes: ["reviewPolicySatisfied"] },
  { from: "readyToMerge", to: "needsReview", causes: ["approvalInvalidated"] },
  { from: "readyToMerge", to: "needsRevision", causes: ["checksFailed"] },
  { from: "needsReview", to: null, causes: ["humanClosed", "merged"] },
  { from: "needsRevision", to: null, causes: ["humanClosed", "merged"] },
  { from: "readyToMerge", to: null, causes: ["humanClosed", "merged"] }
];
var PROFILE_EDGES = {
  issue: ISSUE_EDGES.map((e) => ({ from: e.from, to: e.to })),
  pullRequest: PR_EDGES.map((e) => ({ from: e.from, to: e.to }))
};
function evaluate(edges, request) {
  const edge = edges.find((e) => e.from === request.from && e.to === request.to);
  if (!edge) {
    return {
      allowed: false,
      code: "noSuchEdge",
      reason: `no edge ${String(request.from)} -> ${String(request.to)} in the profile`
    };
  }
  if (!edge.causes.includes(request.cause)) {
    return {
      allowed: false,
      code: "causeNotAccepted",
      reason: `edge ${String(request.from)} -> ${String(request.to)} does not accept cause ${request.cause}`
    };
  }
  return { allowed: true };
}
function canTransitionIssue(request) {
  return evaluate(ISSUE_EDGES, request);
}
function canTransitionPr(request) {
  return evaluate(PR_EDGES, request);
}

// ../core/src/workflow/project.ts
function projectWith(own, observation) {
  const distinct2 = [...new Set(observation.meanings)];
  const ownSet = new Set(own);
  const positions = distinct2.filter((m) => ownSet.has(m));
  if (positions.length > 1) {
    return {
      kind: "conflict",
      positions,
      blocked: isBlocked(distinct2),
      closedBy: observation.closedBy,
      ignored: distinct2.filter((m) => !ownSet.has(m) && m !== "blocked")
    };
  }
  return {
    kind: "position",
    state: {
      meaning: positions[0] ?? null,
      blocked: isBlocked(distinct2),
      closedBy: observation.closedBy
    },
    ignored: distinct2.filter((m) => !ownSet.has(m) && m !== "blocked")
  };
}
function projectIssue(observation) {
  return projectWith(ISSUE_MEANINGS, observation);
}
function projectPullRequest(observation) {
  return projectWith(PR_MEANINGS, observation);
}
function closureOf(projection) {
  return projection.kind === "position" ? projection.state.closedBy : projection.closedBy;
}
function isPausedByProjection(projection) {
  return projection.kind === "position" ? projection.state.blocked : projection.blocked;
}

// ../core/src/github/actors.ts
var AUTOMATION_LOGIN_SUFFIX = "[bot]";
function isAutomationLogin(login) {
  return login.toLowerCase().endsWith(AUTOMATION_LOGIN_SUFFIX);
}

// ../core/src/github/ids.ts
var GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function asDeliveryGuid(raw) {
  return typeof raw === "string" && GUID_PATTERN.test(raw) ? raw : void 0;
}

// ../core/src/github/permissions.ts
var PERMISSION_PATTERN = /^[a-z][a-z_]*:(read|write)$/;
function isPermissionGrant(value) {
  return PERMISSION_PATTERN.test(value);
}
var READ_SUFFIX = ":read";
function widerGrantFor(required) {
  return required.endsWith(READ_SUFFIX) ? `${required.slice(0, -READ_SUFFIX.length)}:write` : null;
}
function missingPermissions(required, granted) {
  const held2 = new Set(granted);
  return required.filter((r) => {
    const wider = widerGrantFor(r);
    return !held2.has(r) && (wider === null || !held2.has(wider));
  });
}

// ../core/src/github/rate-limits.ts
var MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS = 60 * 60;
function parseSecondsHeader(rawValue) {
  if (rawValue === void 0) return { kind: "missing" };
  if (!/^\d+$/.test(rawValue)) {
    return { kind: "invalid", rawValue };
  }
  const seconds = Number(rawValue);
  return Number.isSafeInteger(seconds) ? { kind: "valid", seconds } : { kind: "invalid", rawValue };
}

// ../core/src/github/failures.ts
var BODY_PATTERNS = {
  secondaryRateLimit: {
    pattern: /secondary rate limit/i,
    observed: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
    probedAt: "2026-07-23",
    experiment: "6.4"
  },
  installationSuspended: {
    pattern: /installation is currently suspended/i,
    observed: "This installation is currently suspended. Please contact an organization owner.",
    probedAt: "2026-07-23",
    experiment: "6.1"
  }
};
function classifyFailure(observation) {
  const body = observation.body;
  if (observation.status >= 300 && observation.status < 400 && observation.status !== 304) {
    const location = observation.headers.location;
    return {
      kind: "redirected",
      status: observation.status,
      permanent: observation.status === 301 || observation.status === 308,
      ...location === void 0 ? {} : { location }
    };
  }
  if (observation.status === 401) {
    return observation.tokenPastExpiry === true ? { kind: "tokenExpired" } : { kind: "badCredentials" };
  }
  if (observation.status === 403 || observation.status === 429) {
    if (observation.headers["x-ratelimit-remaining"] === "0") {
      return { kind: "primaryExhausted", resetAt: observation.headers["x-ratelimit-reset"] };
    }
    if (BODY_PATTERNS.secondaryRateLimit.pattern.test(body) || observation.status === 429) {
      const retryAfter = parseSecondsHeader(observation.headers["retry-after"]);
      switch (retryAfter.kind) {
        case "missing":
          return { kind: "secondaryLimit" };
        case "invalid":
          return {
            kind: "rateLimitResponseUnusable",
            headerName: "retry-after",
            headerValue: retryAfter.rawValue,
            reason: "invalid"
          };
        case "valid":
          return retryAfter.seconds > MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS ? {
            kind: "rateLimitResponseUnusable",
            headerName: "retry-after",
            headerValue: String(retryAfter.seconds),
            reason: "aboveAutomaticLimit"
          } : {
            kind: "secondaryLimit",
            retryAfterSeconds: retryAfter.seconds
          };
      }
    }
    const accepted = observation.headers["x-accepted-github-permissions"];
    if (accepted !== void 0) {
      return { kind: "permissionMissing", acceptedPermissions: accepted };
    }
    if (BODY_PATTERNS.installationSuspended.pattern.test(body)) {
      return { kind: "installationSuspended" };
    }
    return { kind: "forbiddenUnrecognized", bodySnippet: body.slice(0, 200) };
  }
  if (observation.status === 404) return { kind: "notFoundOrNotInstalled" };
  if (observation.status === 422) return { kind: "validationError" };
  if (observation.status >= 400 && observation.status < 500 && observation.status !== 408) {
    return { kind: "clientError", status: observation.status };
  }
  return { kind: "transient" };
}
var MAX_RATE_LIMIT_ATTEMPTS = 3;
var MAX_TOKEN_REFRESH_ATTEMPTS = 3;
var BACKOFF_MS = [500, 2e3, 8e3];
function retryAdvice(failure, attempt, nowEpochSeconds) {
  switch (failure.kind) {
    case "tokenExpired":
      return attempt >= MAX_TOKEN_REFRESH_ATTEMPTS ? { action: "doNotRetry", surfaceTo: "operator" } : { action: "refreshTokenAndRetry" };
    case "secondaryLimit":
      return attempt >= MAX_RATE_LIMIT_ATTEMPTS ? { action: "doNotRetry", surfaceTo: "operator" } : {
        action: "retryAfterMs",
        ms: Math.max(6e4, (failure.retryAfterSeconds ?? 0) * 1e3)
      };
    case "primaryExhausted": {
      if (attempt >= MAX_RATE_LIMIT_ATTEMPTS) {
        return { action: "doNotRetry", surfaceTo: "operator" };
      }
      const reset = parseSecondsHeader(failure.resetAt);
      if (reset.kind !== "valid" || !Number.isFinite(nowEpochSeconds)) {
        return { action: "doNotRetry", surfaceTo: "operator" };
      }
      const waitSeconds = Math.max(0, reset.seconds - nowEpochSeconds);
      return waitSeconds > MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS ? { action: "doNotRetry", surfaceTo: "operator" } : { action: "retryAfterMs", ms: waitSeconds * 1e3 };
    }
    case "transient": {
      const ms = BACKOFF_MS[attempt];
      return ms === void 0 ? { action: "doNotRetry", surfaceTo: "operator" } : { action: "retryAfterMs", ms };
    }
    case "validationError":
      return { action: "doNotRetry", surfaceTo: "maintainer" };
    case "badCredentials":
    case "permissionMissing":
    case "installationSuspended":
    case "forbiddenUnrecognized":
    case "rateLimitResponseUnusable":
    case "notFoundOrNotInstalled":
    case "redirected":
    case "clientError":
      return { action: "doNotRetry", surfaceTo: "operator" };
  }
}

// ../core/src/safety/rules.ts
var KILL_SWITCH = {
  outcome: "refuse",
  code: "killSwitch",
  reason: "a kill switch is active"
};
var secondOf = (date) => Math.floor(date.getTime() / 1e3);
function evaluatePreflight(context) {
  if (context.killSwitchActive) return KILL_SWITCH;
  if (!context.world.preconditionHolds) {
    return {
      outcome: "refuse",
      code: "preconditionStale",
      reason: "the authoritative precondition is unavailable, conflicted, or no longer holds (rule 4)"
    };
  }
  return null;
}
var standing = (name, rule) => [name, rule, "standing"];
var itemState = (name, rule) => [name, rule, "itemState"];
var refuse = (code, reason) => ({
  outcome: "refuse",
  code,
  reason
});
var record = (code, reason) => ({
  outcome: "record-only",
  code,
  reason
});
var GENERAL_RULES = [
  standing(
    "observation",
    (f) => f.actionClass === "observation" ? record("observation", "observation records a finding") : null
  ),
  standing(
    "capabilityDisabled",
    (f) => f.capabilityEnabled ? null : refuse(
      "capabilityDisabled",
      "the repository did not enable this capability (rule 1)"
    )
  ),
  standing(
    "permissionMissing",
    (f) => f.missing.length === 0 ? null : refuse(
      "permissionMissing",
      `the installation lacks ${f.missing.join(", ")} (rule 2)`
    )
  ),
  // Reads the derived world, never `claims.closed`, which defaults to no claim (D47).
  itemState(
    "itemClosed",
    (f) => f.context.world.closure === null ? null : refuse(
      "itemClosed",
      `the item is closed (${f.context.world.closure}) \u2014 a closed item accepts no capability write`
    )
  ),
  itemState(
    "itemBlocked",
    (f) => isBlocked(f.context.world.observedMeanings) ? refuse("itemBlocked", "the item is blocked \u2014 capability writes are paused") : null
  ),
  // Before the comparison: unestablished ordering is a conflict, not an absence.
  itemState(
    "humanOrderingUnknown",
    (f) => f.context.latestHumanChangeAt === "unknown" ? refuse(
      "humanOrderingUnknown",
      "ordering evidence for the newest human change is unavailable; the safe default is a conflict (contracts/safety.md \xA73)"
    ) : null
  ),
  itemState(
    "invalidTimestamp",
    (f) => !Number.isFinite(f.request.causeObservedAt.getTime()) || f.request.evaluatedAt !== void 0 && !Number.isFinite(f.request.evaluatedAt.getTime()) || f.context.latestHumanChangeAt !== null && f.context.latestHumanChangeAt !== "unknown" && !Number.isFinite(f.context.latestHumanChangeAt.getTime()) ? refuse(
      "invalidTimestamp",
      "the write request contains an invalid observation or human-change timestamp"
    ) : null
  ),
  // Ties go to the human — `>=`, not `>` (D33); GitHub dates changes in whole seconds (D221).
  itemState(
    "newerHumanChange",
    (f) => f.context.latestHumanChangeAt !== null && f.context.latestHumanChangeAt !== "unknown" && secondOf(f.context.latestHumanChangeAt) >= secondOf(f.request.evaluatedAt ?? f.request.causeObservedAt) ? refuse(
      "newerHumanChange",
      "a human change at or after the cause conflicts; human edits are authoritative (rule 5)"
    ) : null
  ),
  standing(
    "modeDisabled",
    (f) => f.config.mode === "disabled" ? refuse("modeDisabled", "the repository mode is disabled") : null
  ),
  standing(
    "modeRecordsOnly",
    (f) => f.config.mode === "observe" || f.config.mode === "dry-run" ? record(
      "modeRecordsOnly",
      `repository mode is ${f.config.mode}; the effect is recorded, not applied (rule 10)`
    ) : null
  )
];
function standingFacts(request, config, context) {
  return {
    config,
    actionClass: request.actionClass,
    // Derived, never supplied: the reviewed file is the only source (D73).
    capabilityEnabled: config.capabilities[request.capability]?.enabled === true,
    missing: missingPermissions(request.requiredPermissions, context.installationGrants)
  };
}
function evaluateGeneralRulesAfterPreflight(request, config, context) {
  const facts = { ...standingFacts(request, config, context), request, context };
  for (const [, rule] of GENERAL_RULES) {
    const verdict = rule(facts);
    if (verdict !== null) return verdict;
  }
  return { outcome: "apply" };
}
function evaluateStandingRules(request, config, context) {
  if (context.killSwitchActive) return KILL_SWITCH;
  const facts = standingFacts(request, config, context);
  for (const entry of GENERAL_RULES) {
    if (entry[2] !== "standing") continue;
    const verdict = entry[1](facts);
    if (verdict !== null) return verdict;
  }
  return { outcome: "apply" };
}

// ../core/src/safety/write.ts
function evaluateWrite(request, config, context) {
  const preflight = evaluatePreflight(context);
  if (preflight !== null) return preflight;
  if (request.actionClass === "clockTriggeredDestructive") {
    return {
      outcome: "refuse",
      code: "wrongEntryPoint",
      reason: "a clock-triggered destructive action must be evaluated by evaluateDestructive, which alone enforces the warning and grace gates"
    };
  }
  if (request.actionClass === "immediatePreventive") {
    return {
      outcome: "refuse",
      code: "preventiveGateUnavailable",
      reason: "immediate preventive actions are disabled until the request proves an immediate explanation and a simple maintainer reversal (D54)"
    };
  }
  return evaluateGeneralRulesAfterPreflight(request, config, context);
}

// ../core/src/safety/destructive.ts
var DESTRUCTIVE_WARNING_BRAND = /* @__PURE__ */ Symbol("DestructiveWarning");
function createDestructiveWarning(input) {
  const requestSnapshot = Object.freeze({
    actionClass: input.request.actionClass,
    capability: input.request.capability,
    causeObservedAtMs: input.request.causeObservedAt.getTime(),
    cause: input.request.cause,
    item: input.request.target.item,
    change: input.request.target.change
  });
  return Object.freeze({
    [DESTRUCTIVE_WARNING_BRAND]: true,
    requestSnapshot,
    warnedAtMs: input.warnedAt.getTime(),
    gracePeriodHours: input.gracePeriodHours,
    earliestActionAtMs: input.earliestActionAt.getTime(),
    cancelledBy: input.cancelledBy,
    reversesWith: input.reversesWith
  });
}
function activitySinceWarning(activityAt, warning) {
  return activityAt !== null && secondOf(activityAt) >= secondOf(new Date(warning.warnedAtMs));
}
var MIN_GRACE_HOURS = 1;
var MIN_REAP_HOURS = 2;
var HOUR_MS = 60 * 60 * 1e3;
function warningMatchesRequest(warned, requested) {
  return warned.actionClass === requested.actionClass && warned.capability === requested.capability && warned.causeObservedAtMs === requested.causeObservedAt.getTime() && warned.cause === requested.cause && warned.item === requested.target.item && warned.change === requested.target.change;
}
function evaluateDestructive(plan, config, context, now) {
  const preflight = evaluatePreflight(context);
  if (preflight !== null) return preflight;
  if (plan.request.actionClass !== "clockTriggeredDestructive") {
    return {
      outcome: "refuse",
      code: "wrongActionClass",
      reason: "evaluateDestructive only accepts clock-triggered destructive requests"
    };
  }
  if (plan.warning === null) {
    return {
      outcome: "refuse",
      code: "noWarning",
      reason: "no recorded warning \u2014 a destructive action never occurs on first observation (grace.md)"
    };
  }
  if (!warningMatchesRequest(plan.warning.requestSnapshot, plan.request)) {
    return {
      outcome: "refuse",
      code: "warningRequestMismatch",
      reason: "the recorded warning does not authorize this exact capability, target, change, and causal observation"
    };
  }
  if (!Number.isFinite(plan.warning.gracePeriodHours) || !Number.isFinite(plan.warning.warnedAtMs) || !Number.isFinite(plan.warning.earliestActionAtMs) || !Number.isFinite(plan.warning.requestSnapshot.causeObservedAtMs) || plan.warning.cancelledBy.trim() === "" || plan.warning.reversesWith.trim() === "" || !Number.isFinite(now.getTime())) {
    return {
      outcome: "refuse",
      code: "invalidDestructivePlan",
      reason: "the destructive plan contains a non-finite grace period or invalid timestamp"
    };
  }
  if (plan.warning.gracePeriodHours < MIN_GRACE_HOURS) {
    return {
      outcome: "refuse",
      code: "graceBelowFloor",
      reason: `grace period ${plan.warning.gracePeriodHours}h is below the ${MIN_GRACE_HOURS}h floor (grace.md)`
    };
  }
  const minimumActionAt = plan.warning.warnedAtMs + plan.warning.gracePeriodHours * HOUR_MS;
  if (plan.warning.warnedAtMs < plan.warning.requestSnapshot.causeObservedAtMs || plan.warning.earliestActionAtMs < minimumActionAt) {
    return {
      outcome: "refuse",
      code: "invalidDestructivePlan",
      reason: "the warning predates its observation or states an action time before the full grace period"
    };
  }
  if (now.getTime() < plan.warning.earliestActionAtMs) {
    return {
      outcome: "refuse",
      code: "graceRunning",
      reason: "the grace period has not fully elapsed (grace.md)"
    };
  }
  if (plan.qualifyingActivitySinceWarning) {
    return {
      outcome: "refuse",
      code: "activityCancelled",
      reason: "the affected person provided qualifying activity during the grace period (grace.md)"
    };
  }
  return evaluateGeneralRulesAfterPreflight(plan.request, config, context);
}

// ../core/src/safety/world.ts
var DERIVED = /* @__PURE__ */ Symbol("derived-by-engine");
function observedMeaningsOf(projection) {
  const present = /* @__PURE__ */ new Set();
  if (projection.kind === "position") {
    if (projection.state.meaning !== null) present.add(projection.state.meaning);
    if (projection.state.blocked) present.add("blocked");
  } else {
    for (const position of projection.positions) present.add(position);
    if (projection.blocked) present.add("blocked");
  }
  for (const ignored of projection.ignored) present.add(ignored);
  return MAPPABLE_MEANINGS.filter((m) => present.has(m));
}
function expectedHolds(claims, projection, modes = {}) {
  const observed = new Set(observedMeaningsOf(projection));
  for (const meaning of claims.meaningsPresent) {
    if (!observed.has(meaning)) return false;
  }
  for (const meaning of claims.meaningsAbsent) {
    if (observed.has(meaning)) return false;
  }
  if (claims.closed !== null) {
    const isClosed = closureOf(projection) !== null;
    if (claims.closed !== isClosed) return false;
  }
  if (claims.pullRequestMode !== void 0 && modes[claims.pullRequestMode] !== true) {
    return false;
  }
  return true;
}
function deriveWorld(projection, claims, modes = {}) {
  return {
    observedMeanings: projection === null ? [] : observedMeaningsOf(projection),
    preconditionHolds: projection !== null && projection.kind === "position" && expectedHolds(claims, projection, modes),
    closure: projection === null ? null : closureOf(projection),
    modes,
    [DERIVED]: true
  };
}

// ../core/src/catalogue.ts
var UNREAD = "unread";
var FACT_KINDS = ["issue", "pullRequest"];
var FACT_GROUPS = [
  "locked",
  "skills",
  "assignees",
  "links",
  "review",
  "readiness",
  "command"
];
var MANAGED_COMMENT_KINDS = ["summary", "warning", "notice"];

// ../core/src/capability/groups/decode.ts
var recordOf = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
function instantOf(value) {
  if (typeof value !== "string") return null;
  const at2 = new Date(value);
  return Number.isFinite(at2.getTime()) ? at2 : null;
}
function optionalInstant(value) {
  if (value === null) return { at: null };
  const at2 = instantOf(value);
  return at2 === null ? null : { at: at2 };
}
function itemOf(value) {
  const ref = recordOf(value);
  const kind = ENTITY_KINDS.find((named2) => named2 === ref?.["kind"]);
  const number = ref?.["number"];
  return kind === void 0 || typeof number !== "number" || !Number.isSafeInteger(number) ? null : { kind, number };
}
function each(value, read) {
  if (!Array.isArray(value)) return null;
  const entries = [];
  for (const entry of value) {
    const one = read(entry);
    if (one === null) return null;
    entries.push(one);
  }
  return entries;
}
function clockOf(value) {
  const clock = recordOf(value);
  if (clock === null || typeof clock["login"] !== "string") return null;
  const assignedAt = instantOf(clock["assignedAt"]);
  const worked = optionalInstant(clock["lastWorkingAt"]);
  return assignedAt === null || worked === null ? null : { login: clock["login"], assignedAt, lastWorkingAt: worked.at };
}
var clocksOf = (value) => each(value, clockOf);
function linkedOf(value) {
  const linked = recordOf(value);
  const item = itemOf(linked?.["item"]);
  const assignees3 = clocksOf(linked?.["assignees"]);
  return item === null || assignees3 === null ? null : { item, assignees: assignees3 };
}

// ../core/src/capability/groups/assignees.ts
var assignees = {
  readBy: { issue: ["sweep"], pullRequest: ["sweep"] },
  kept: { issue: clocksOf, pullRequest: clocksOf },
  fixture: { issue: [], pullRequest: [] }
};

// ../core/src/capability/groups/command.ts
var AT = /* @__PURE__ */ new Date("2026-07-01T00:00:00.000Z");
var command = {
  readBy: { issue: ["issue_comment"] },
  fromDelivery: (delivery) => delivery.command ?? null,
  fixture: { issue: { issued: null, by: "actor", at: AT } }
};

// ../core/src/capability/groups/links.ts
var links = {
  readBy: { issue: ["sweep"], pullRequest: ["sweep"] },
  kept: {
    pullRequest: (value) => {
      const issues = each(recordOf(value)?.["issues"], linkedOf);
      return issues === null ? null : { issues };
    }
  },
  fixture: { issue: { openPullRequests: [] }, pullRequest: { issues: [] } }
};

// ../core/src/capability/groups/locked.ts
var locked = {
  readBy: { issue: ["issues", "issue_comment", "sweep"] },
  fromDelivery: ({ item }) => typeof item["locked"] === "boolean" ? item["locked"] : null,
  missing: { code: "lockedMissing", detail: "locked missing" },
  fixture: { issue: false }
};

// ../core/src/capability/groups/readiness.ts
var readiness = {
  readBy: { pullRequest: ["pull_request", "sweep"] },
  kept: {
    pullRequest: (value) => {
      const read = recordOf(value);
      return read === null || typeof read["draft"] !== "boolean" ? null : { draft: read["draft"] };
    }
  },
  fromDelivery: ({ item }) => typeof item["draft"] === "boolean" ? { draft: item["draft"] } : null,
  missing: { code: "draftMissing", detail: "draft missing" },
  fixture: { pullRequest: { draft: true } }
};

// ../core/src/capability/groups/review.ts
var SINCE = /* @__PURE__ */ new Date("2026-07-01T00:00:00.000Z");
var review = {
  readBy: { pullRequest: ["sweep"] },
  kept: {
    pullRequest: (value) => {
      const read = recordOf(value);
      const since2 = recordOf(read?.["reapableSince"]);
      const needsRevision = instantOf(since2?.["needsRevision"]);
      const changesRequested = instantOf(since2?.["changesRequested"]);
      const draft = instantOf(since2?.["draft"]);
      const commit = optionalInstant(read?.["lastCommitAt"]);
      if (read === null || typeof read["changesRequested"] !== "boolean") return null;
      if (needsRevision === null || changesRequested === null || draft === null) return null;
      if (commit === null) return null;
      return {
        changesRequested: read["changesRequested"],
        reapableSince: { needsRevision, changesRequested, draft },
        lastCommitAt: commit.at
      };
    }
  },
  fixture: {
    pullRequest: {
      changesRequested: false,
      reapableSince: { needsRevision: SINCE, changesRequested: SINCE, draft: SINCE },
      lastCommitAt: null
    }
  }
};

// ../core/src/capability/groups/skills.ts
var skills = {
  readBy: { issue: ["issues", "issue_comment", "sweep"] },
  fromDelivery: (delivery) => delivery.skills,
  fixture: { issue: [] }
};

// ../core/src/capability/groups/module.ts
var WEBHOOK_PRODUCERS = ["issues", "issue_comment", "pull_request"];
var PRODUCER_NAMES = [...WEBHOOK_PRODUCERS, "sweep"];
var PRODUCER_KINDS = {
  issues: ["issue"],
  issue_comment: ["issue"],
  pull_request: ["pullRequest"],
  sweep: ["issue", "pullRequest"]
};

// ../core/src/capability/groups/index.ts
var GROUPS = {
  locked,
  skills,
  assignees,
  links,
  review,
  readiness,
  command
};
var moduleOf = (group) => GROUPS[group];
function readersOf(kind, group) {
  return moduleOf(group).readBy[kind] ?? [];
}
function carriesFactGroup(kind, group) {
  return moduleOf(group).readBy[kind] !== void 0;
}
function factGroupUnread(facts, group) {
  return carriesFactGroup(facts.kind, group) && facts[group] === UNREAD;
}
function keptOn(kind) {
  return FACT_GROUPS.filter((group) => moduleOf(group).kept?.[kind] !== void 0);
}
function decodeKept(kind, group, value) {
  if (value === UNREAD) return UNREAD;
  return moduleOf(group).kept?.[kind]?.(value) ?? null;
}
function deliveredGroups(producer, kind, delivery) {
  const groups = {};
  for (const group of FACT_GROUPS) {
    if (!carriesFactGroup(kind, group)) continue;
    const module = moduleOf(group);
    if (!readersOf(kind, group).includes(producer) || module.fromDelivery === void 0) {
      groups[group] = UNREAD;
      continue;
    }
    const value = module.fromDelivery(delivery);
    if (value !== null) {
      groups[group] = value;
      continue;
    }
    if (module.missing === void 0) {
      groups[group] = UNREAD;
      continue;
    }
    return {
      ok: false,
      code: module.missing.code,
      detail: `${producer}: ${module.missing.detail}`
    };
  }
  return { ok: true, groups };
}

// ../core/src/capability/producers.ts
function rowOf(producer, kind) {
  const makes = PRODUCER_KINDS[producer];
  if (!makes.includes(kind)) return null;
  return FACT_GROUPS.filter((group) => readersOf(kind, group).includes(producer));
}
var PRODUCERS = Object.fromEntries(
  PRODUCER_NAMES.map((producer) => [
    producer,
    Object.fromEntries(FACT_KINDS.map((kind) => [kind, rowOf(producer, kind)]))
  ])
);
var ROWS = PRODUCERS;
function isName(names, name) {
  return names.some((known) => known === name);
}
function isWebhookProducer(name) {
  return isName(WEBHOOK_PRODUCERS, name);
}
function producesKind(producer, kind) {
  return ROWS[producer][kind] !== null;
}
function producerReads(producer, kind, group) {
  return ROWS[producer][kind]?.includes(group) ?? false;
}
function groupsNeeded(config, capabilities2, kind) {
  const needed = /* @__PURE__ */ new Set();
  for (const { declaration } of capabilities2) {
    if (config.capabilities[declaration.name]?.enabled !== true) continue;
    if (!declaration.triggers.some((trigger) => trigger.kind === "schedule")) continue;
    if (!declaration.facts.includes(kind)) continue;
    for (const need of declaration.needs[kind]) needed.add(need);
  }
  return PRODUCERS.sweep[kind].filter((group) => needed.has(group));
}

// ../core/src/capability/facts.ts
function isPaused(facts) {
  return isPausedByProjection(facts.position);
}
function isConflicted(facts) {
  return facts.position.kind === "conflict";
}
function meaningsOf(facts) {
  return observedMeaningsOf(facts.position);
}
function modesOf(facts) {
  if (facts.kind !== "pullRequest") return {};
  return {
    ...facts.readiness === UNREAD ? {} : { draft: facts.readiness.draft },
    ...facts.review === UNREAD ? {} : { changesRequested: facts.review.changesRequested }
  };
}
function moveTo(facts, meaning) {
  if (facts.position.kind === "conflict") return null;
  const from = facts.position.state.meaning;
  const edges = facts.kind === "issue" ? ISSUE_EDGES : PR_EDGES;
  return edges.find((edge) => edge.from === from && edge.to === meaning)?.causes[0] ?? null;
}
async function people(platform, assignees3) {
  const found = [];
  for (const assignee of assignees3) {
    const isBot = await platform.resolve("isAutomationActor", { login: assignee.login });
    if (!isBot.ok || isBot.value) continue;
    found.push(assignee);
  }
  return found;
}
var HOUR_MS2 = 60 * 60 * 1e3;
var HOURS_PER_DAY = 24;
function startedAt(base, resets) {
  const newest = latestOf(resets);
  return newest !== null && newest.getTime() > base.getTime() ? newest : base;
}
function clockFrom(idleSince, observedAt) {
  return {
    idleSince,
    idleHours: Math.floor((observedAt.getTime() - idleSince.getTime()) / HOUR_MS2)
  };
}
function assigneeClock(assignee, observedAt) {
  return clockFrom(startedAt(assignee.assignedAt, [assignee.lastWorkingAt]), observedAt);
}
function pullRequestClock(facts, reason, observedAt) {
  return clockFrom(
    startedAt(facts.review.reapableSince[reason], [
      facts.review.lastCommitAt,
      ...facts.assignees.map((assignee) => assignee.lastWorkingAt)
    ]),
    observedAt
  );
}
function latestOf(instants) {
  let newest = null;
  for (const instant2 of instants) {
    if (instant2 !== null && (newest === null || instant2.getTime() > newest.getTime())) {
      newest = instant2;
    }
  }
  return newest;
}
var mentions = (logins) => logins.map((login) => `@${login}`).join(", ");
var ACTIVE_MARKDOWN = /[\\`*_[\]()<>&|~#!]/g;
var ZERO_WIDTH_SPACE = "\u200B";
var QUOTED_LIMIT = 120;
function inert(text3) {
  const oneLine = text3.replace(/\s+/gu, " ").trim();
  const capped = oneLine.length > QUOTED_LIMIT ? `${oneLine.slice(0, QUOTED_LIMIT)}\u2026` : oneLine;
  return capped.replace(ACTIVE_MARKDOWN, (char) => `\\${char}`).replaceAll("@", `@${ZERO_WIDTH_SPACE}`);
}
function on(deadline, graceHours) {
  const iso = deadline.toISOString();
  return graceHours < HOURS_PER_DAY ? `**${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC**` : `**${iso.slice(0, 10)}**`;
}
function lasting(hours) {
  const [count2, noun] = hours !== 0 && hours % HOURS_PER_DAY === 0 ? [hours / HOURS_PER_DAY, "day"] : [hours, "hour"];
  return `${String(count2)} ${noun}${count2 === 1 ? "" : "s"}`;
}
var CANCELLED_BY = "a commit or a /working comment";
var REVERSES_WITH = "re-assign / reopen";

// ../core/src/intents/operations/applyMappedLabel.ts
var applyMappedLabel = {
  facts: {
    idempotencyClass: "idempotent",
    actionClassFloor: "reversibleStateChange",
    permission: "issues:write"
  },
  describeChange(subject) {
    return `set mapped position ${subject.desired.meaning}`;
  }
};

// ../core/src/intents/operations/assign.ts
var assign = {
  facts: {
    idempotencyClass: "idempotent",
    actionClassFloor: "reversibleStateChange",
    permission: "issues:write"
  },
  describeChange(subject) {
    return `assign ${subject.desired.login}`;
  }
};

// ../core/src/intents/operations/closePullRequest.ts
var closePullRequest = {
  facts: {
    idempotencyClass: "idempotent",
    actionClassFloor: "clockTriggeredDestructive",
    permission: "pull_requests:write"
  },
  describeChange(subject) {
    return `close pull request: ${subject.desired.reason}`;
  }
};

// ../core/src/intents/operations/lockIssue.ts
var lockIssue = {
  facts: {
    idempotencyClass: "idempotent",
    actionClassFloor: "reversibleStateChange",
    permission: "issues:write"
  },
  describeChange(subject) {
    return `lock issue: ${subject.desired.reason}`;
  }
};

// ../core/src/intents/operations/postManagedComment.ts
var postManagedComment = {
  // 6.5: comment creation duplicates on a blind retry. Not negotiable.
  facts: {
    idempotencyClass: "nonIdempotent",
    actionClassFloor: "humanFacingOutput",
    permission: "issues:write"
  },
  describeChange(subject) {
    return `managed ${subject.desired.kind} comment from ${subject.capability}`;
  }
};

// ../core/src/intents/operations/releaseAssignment.ts
var releaseAssignment = {
  facts: {
    idempotencyClass: "idempotent",
    actionClassFloor: "clockTriggeredDestructive",
    permission: "issues:write"
  },
  describeChange(subject) {
    return `release ${subject.desired.login}`;
  }
};

// ../core/src/intents/operations/unassign.ts
var unassign = {
  facts: {
    idempotencyClass: "idempotent",
    actionClassFloor: "reversibleStateChange",
    permission: "issues:write"
  },
  describeChange(subject) {
    return `unassign ${subject.desired.login}`;
  }
};

// ../core/src/intents/operations/unlockIssue.ts
var unlockIssue = {
  facts: {
    idempotencyClass: "idempotent",
    actionClassFloor: "reversibleStateChange",
    permission: "issues:write"
  },
  describeChange(subject) {
    return `unlock issue: ${subject.desired.reason}`;
  }
};

// ../core/src/intents/operations/index.ts
var OPERATIONS = {
  postManagedComment,
  applyMappedLabel,
  assign,
  unassign,
  releaseAssignment,
  closePullRequest,
  lockIssue,
  unlockIssue
};
var INTENT_OPERATIONS = Object.fromEntries(
  Object.entries(OPERATIONS).map(([operation, module]) => [operation, module.facts])
);

// ../core/src/intents/intent.ts
function deriveIdempotencyKey(intent) {
  const parts = [
    intent.capability,
    intent.repository.owner,
    intent.repository.repo,
    intent.item.kind,
    String(intent.item.number),
    intent.operation,
    intent.cause.cause,
    intent.cause.observedAt.toISOString()
  ];
  if (intent.cause.deliveryId !== void 0) parts.push(intent.cause.deliveryId);
  return JSON.stringify(parts);
}

// ../core/src/intents/managed.ts
import { createHash as createHash2 } from "node:crypto";
var MANAGED_MARKER_PREFIX = "<!-- hiero-automation:";
var MANAGED_MARKER_SUFFIX = " -->";
var MANAGED_MARKER_SCHEMA_VERSION = 2;
var MANAGED_PAYLOAD_BYTE_LIMIT = 2048;
var MANAGED_SUBJECT_DIGEST_LENGTH = 16;
var subjectDigest = (identity) => createHash2("sha256").update(
  JSON.stringify([
    identity.capability,
    identity.item.kind,
    String(identity.item.number),
    identity.kind,
    identity.topic
  ]),
  "utf8"
).digest("hex").slice(0, MANAGED_SUBJECT_DIGEST_LENGTH);
function managedMarkerPayload(identity, record2) {
  return {
    schemaVersion: MANAGED_MARKER_SCHEMA_VERSION,
    capability: identity.capability,
    kind: identity.kind,
    subject: subjectDigest(identity),
    ...record2 === void 0 ? {} : { record: record2 }
  };
}
function deriveManagedMarker(identity, record2) {
  const payload = managedMarkerPayload(identity, record2);
  const encoded = JSON.stringify({
    schemaVersion: payload.schemaVersion,
    capability: payload.capability,
    kind: payload.kind,
    subject: payload.subject,
    ...payload.record === void 0 ? {} : { record: orderedRecord(payload.record) }
  });
  return `${MANAGED_MARKER_PREFIX}${encoded}${MANAGED_MARKER_SUFFIX}`;
}
function orderedRecord(record2) {
  return {
    effectId: record2.effectId,
    actionClass: record2.actionClass,
    capability: record2.capability,
    causeObservedAt: record2.causeObservedAt,
    cause: record2.cause,
    item: record2.item,
    change: record2.change,
    gracePeriodHours: record2.gracePeriodHours,
    cancelledBy: record2.cancelledBy,
    reversesWith: record2.reversesWith
  };
}
function managedCommentOf(identity, record2) {
  return { identity, marker: deriveManagedMarker(identity, record2) };
}
var DIGEST_PATTERN = /^[0-9a-f]+$/;
function jsonObject(text3) {
  try {
    const value = JSON.parse(text3);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
var UTF8 = new TextEncoder();
var isManagedCommentKind = (value) => MANAGED_COMMENT_KINDS.includes(value);
var RECORD_STRINGS = [
  "effectId",
  "actionClass",
  "capability",
  "causeObservedAt",
  "cause",
  "item",
  "change",
  "cancelledBy",
  "reversesWith"
];
function warningRecordOf(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const fields = value;
  if (RECORD_STRINGS.some((name) => typeof fields[name] !== "string" || fields[name] === "")) {
    return null;
  }
  const hours = fields["gracePeriodHours"];
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) return null;
  const record2 = Object.fromEntries(RECORD_STRINGS.map((name) => [name, fields[name]]));
  return orderedRecord({ ...record2, gracePeriodHours: hours });
}
function parseManagedMarker(body) {
  if (!body.startsWith(MANAGED_MARKER_PREFIX)) return { unrecognized: "noMarker" };
  const end = body.indexOf(MANAGED_MARKER_SUFFIX);
  if (end < 0) return { unrecognized: "noMarker" };
  const encoded = body.slice(MANAGED_MARKER_PREFIX.length, end);
  if (UTF8.encode(encoded).length > MANAGED_PAYLOAD_BYTE_LIMIT) {
    return { unrecognized: "oversized" };
  }
  const fields = jsonObject(encoded);
  if (fields === null) return { unrecognized: "malformed" };
  const version = fields["schemaVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { unrecognized: "malformed" };
  }
  if (version < MANAGED_MARKER_SCHEMA_VERSION) return { unrecognized: "priorVersion" };
  if (version > MANAGED_MARKER_SCHEMA_VERSION) return { unrecognized: "futureVersion" };
  const capability = fields["capability"];
  const kind = fields["kind"];
  const subject = fields["subject"];
  if (typeof capability !== "string" || capability === "") return { unrecognized: "malformed" };
  if (!isManagedCommentKind(kind)) return { unrecognized: "malformed" };
  if (typeof subject !== "string" || subject.length !== MANAGED_SUBJECT_DIGEST_LENGTH || !DIGEST_PATTERN.test(subject)) {
    return { unrecognized: "malformed" };
  }
  if (fields["record"] === void 0) {
    return {
      recognized: { schemaVersion: MANAGED_MARKER_SCHEMA_VERSION, capability, kind, subject }
    };
  }
  const record2 = kind === "warning" ? warningRecordOf(fields["record"]) : null;
  if (record2 === null) return { unrecognized: "malformed" };
  return {
    recognized: {
      schemaVersion: MANAGED_MARKER_SCHEMA_VERSION,
      capability,
      kind,
      subject,
      record: record2
    }
  };
}
function matchesManagedComment(candidate, mine) {
  if (!candidate.authoredByApp) return { matches: false, why: "notAppAuthored" };
  const reading = parseManagedMarker(candidate.body);
  if (!("recognized" in reading)) return { matches: false, why: "noManagedMarker" };
  const found = reading.recognized;
  return found.capability === mine.capability && found.kind === mine.kind && found.subject === mine.subject ? { matches: true } : { matches: false, why: "otherSubject" };
}
function addressManagedComment(body, mention, principals2) {
  if (mention === void 0) return body;
  const handle = principals2[mention];
  return handle === void 0 ? `\`${mention}\` \u2014 ${body}` : `@${handle} \u2014 ${body}`;
}

// ../core/src/capability/declaration.ts
function kindsImpliedBy(triggers) {
  const kinds = /* @__PURE__ */ new Set();
  for (const trigger of triggers) {
    if (trigger.kind !== "event") continue;
    for (const kind of FACT_KINDS) if (producesKind(trigger.event, kind)) kinds.add(kind);
  }
  return FACT_KINDS.filter((kind) => kinds.has(kind));
}
var isNeedsList = (needs) => Array.isArray(needs);
function needsPerKind(needs, kinds) {
  const filled = { issue: [], pullRequest: [] };
  if (needs === void 0) return filled;
  if (!isNeedsList(needs)) {
    for (const kind of FACT_KINDS) filled[kind] = [...needs[kind] ?? []];
    return filled;
  }
  for (const group of needs) {
    const carriers = kinds.filter((kind) => carriesFactGroup(kind, group));
    for (const kind of carriers.length > 0 ? carriers : kinds) filled[kind].push(group);
  }
  return filled;
}
function declareCapability(d) {
  const facts = d.facts ?? kindsImpliedBy(d.triggers);
  const filled = {
    ...d,
    facts,
    needs: needsPerKind(d.needs, facts),
    requiredMappings: d.requiredMappings ?? {},
    labels: d.labels ?? []
  };
  return filled;
}

// ../core/src/capability/factory.ts
function intentFactory(capability, occasion) {
  return (spec2) => {
    const base = {
      capability,
      repository: occasion.repository,
      item: occasion.item,
      operation: spec2.operation,
      claims: {
        meaningsPresent: spec2.claims?.meaningsPresent ?? [],
        meaningsAbsent: spec2.claims?.meaningsAbsent ?? [],
        closed: spec2.claims?.closed ?? null,
        // Written in only when claimed: a key spelled `undefined` would
        // not match the same intent built from bytes.
        ...spec2.claims?.pullRequestMode === void 0 ? {} : { pullRequestMode: spec2.claims.pullRequestMode }
      },
      desired: spec2.desired,
      cause: {
        cause: spec2.cause,
        observedAt: occasion.observedAt,
        ...occasion.deliveryId === void 0 ? {} : { deliveryId: occasion.deliveryId }
      },
      explanation: {
        capability,
        summary: spec2.explain.summary,
        detail: spec2.explain.detail ?? []
      },
      grace: spec2.grace ?? null
    };
    return {
      ...base,
      idempotencyKey: deriveIdempotencyKey(base)
    };
  };
}
function derivedClaims(facts, desired) {
  const present = meaningsOf(facts);
  const applying = "meaning" in desired ? desired.meaning : null;
  return {
    meaningsPresent: present,
    meaningsAbsent: applying !== null && !present.includes(applying) ? [applying] : [],
    closed: closureOf(facts.position) !== null
  };
}
function desiredOf(facts, desired) {
  if (!("meaning" in desired)) return desired;
  const cause = desired.cause ?? moveTo(facts, desired.meaning);
  return cause === null ? null : { meaning: desired.meaning, cause };
}
function buildIntent(capability, facts, request) {
  const desired = desiredOf(facts, request.desired);
  if (desired === null) return null;
  const derived = derivedClaims(facts, request.desired);
  const explain = typeof request.explain === "string" ? { summary: request.explain } : request.explain;
  const cause = request.cause ?? (facts.trigger.kind === "sweep" ? "sweep" : facts.trigger.event);
  return intentFactory(capability, {
    repository: facts.repository,
    item: facts.item,
    observedAt: request.occasion ?? facts.observedAt,
    ...facts.trigger.kind === "event" && facts.trigger.deliveryId !== void 0 ? { deliveryId: facts.trigger.deliveryId } : {}
  })({
    operation: request.operation,
    desired,
    cause,
    claims: { ...derived, ...request.claims },
    explain,
    ...request.grace === void 0 ? {} : { grace: request.grace }
  });
}

// ../core/src/capability/boundary.ts
function defaultsOf(declaration, view) {
  const resolved = readSettings(declaration.settings, view, {});
  return resolved.ok ? resolved.value : {};
}
function projectCapabilityView(declaration, config) {
  const block2 = config.capabilities[declaration.name];
  const view = {
    mapped: {
      labels: Object.keys(config.mappings.labels),
      commands: Object.keys(config.mappings.commands),
      skills: Object.keys(config.mappings.skills),
      alerts: Object.keys(config.mappings.alerts)
    },
    principals: Object.keys(config.principals)
  };
  const resolved = block2?.settings ?? defaultsOf(declaration, view);
  return { settings: resolved, ...view };
}

// ../core/src/capability/settings.ts
var HOURS_PER_DAY2 = 24;
var MAX_CLOCK_HOURS = 36500 * HOURS_PER_DAY2;
var DURATION_PATTERN = /^[1-9][0-9]*[hd]$|^0[hd]$/;
function parseDuration(written) {
  if (!DURATION_PATTERN.test(written)) return null;
  const value = Number(written.slice(0, -1));
  return written.endsWith("d") ? value * HOURS_PER_DAY2 : value;
}
function writeDuration(hours) {
  if (hours !== 0 && hours % HOURS_PER_DAY2 === 0) {
    return `${String(hours / HOURS_PER_DAY2)}d`;
  }
  return `${String(hours)}h`;
}
function isRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function clockHours(value) {
  if (typeof value !== "string") return null;
  const hours = parseDuration(value);
  return hours !== null && hours <= MAX_CLOCK_HOURS ? hours : null;
}
function inner(raw, path, fields, outer) {
  return { raw, path, fields, outer, view: outer.view };
}
function strangers(stated, known, path) {
  return Object.keys(stated).filter((name) => !known.includes(name)).map((name) => ({
    code: "unknownKey",
    path: dot(path, name),
    message: known.length === 0 ? `${JSON.stringify(name)} is not a setting this group takes` : `${JSON.stringify(name)} is not one of ${known.join(", ")}`
  }));
}
function spec(fields) {
  return fields;
}
function flag(options) {
  return {
    describe: () => ({
      kind: "flag",
      doc: options.doc ?? null,
      absent: "default",
      default: options.default,
      ...options.needs === void 0 ? {} : { needs: options.needs }
    }),
    read(key, scope) {
      const path = dot(scope.path, key);
      if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: options.default };
      const value = scope.raw[key];
      if (typeof value !== "boolean") return problem(path, "must be true or false");
      const family = options.needs;
      if (value && family !== void 0 && scope.view.mapped[family].length === 0) {
        return problem(path, `needs at least one entry under mappings.${family}`);
      }
      return { ok: true, value };
    }
  };
}
var UNSTATED = /* @__PURE__ */ Symbol("unstated");
function statedAt(raw, path) {
  let here = raw;
  for (const segment of path) {
    if (!isRecord(here) || !Object.hasOwn(here, segment)) return UNSTATED;
    here = here[segment];
  }
  return here;
}
function declaredAt(fields, path) {
  const [head, ...rest] = path;
  const field2 = head === void 0 ? void 0 : fields[head];
  if (field2 === void 0) return void 0;
  if (rest.length === 0) return field2.cascades?.default;
  return field2.within === void 0 ? void 0 : declaredAt(field2.within, rest);
}
function durationNamed(name, from) {
  const path = name.split(".");
  for (let level = from; level !== null; level = level.outer) {
    const stated = statedAt(level.raw, path);
    if (stated !== UNSTATED) return clockHours(stated);
  }
  for (let level = from; level !== null; level = level.outer) {
    const declared = declaredAt(level.fields, path);
    if (declared !== void 0) return declared;
  }
  return null;
}
function durationAbsent(options) {
  if (options.inherits !== void 0) return "inherited";
  if (options.default !== void 0) return "default";
  return "problem";
}
function malformed(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    const spelled3 = String(value);
    return `must be a duration with a unit \u2014 write "${spelled3}d" for days or "${spelled3}h" for hours`;
  }
  return 'must be a duration: a whole number of hours or days, written "4h" or "14d"';
}
function duration(options = {}) {
  const declared = options.default === void 0 ? null : parseDuration(options.default);
  if (options.default !== void 0 && declared === null) {
    throw new Error(`duration default ${JSON.stringify(options.default)} is not a duration`);
  }
  const bounded = (hours, path, scope) => {
    if (hours > MAX_CLOCK_HOURS) {
      return problem(path, `must be at most ${writeDuration(MAX_CLOCK_HOURS)}`);
    }
    if (options.atLeast !== void 0 && hours < options.atLeast) {
      return problem(path, `must be at least ${writeDuration(options.atLeast)}`);
    }
    if (options.above === void 0) return { ok: true, value: hours };
    const [target, by] = options.above;
    const floor = durationNamed(target, scope);
    if (floor === null) return { ok: true, value: hours };
    const gap = Math.max(by, MIN_GRACE_HOURS);
    if (hours < floor + gap) {
      return problem(
        path,
        `must be at least ${writeDuration(gap)} above ${target} (${writeDuration(floor)})`
      );
    }
    return { ok: true, value: hours };
  };
  return {
    ...declared === null ? {} : { cascades: { default: declared } },
    describe: () => ({
      kind: "duration",
      doc: options.doc ?? null,
      absent: durationAbsent(options),
      ...options.default === void 0 ? {} : { default: options.default },
      ...options.inherits === void 0 ? {} : { inherits: options.inherits },
      ...options.above === void 0 ? {} : { above: options.above },
      ...options.atLeast === void 0 ? {} : { atLeast: options.atLeast }
    }),
    read(key, scope) {
      const path = dot(scope.path, key);
      if (Object.hasOwn(scope.raw, key)) {
        const written = scope.raw[key];
        const hours = typeof written === "string" ? parseDuration(written) : null;
        return hours === null ? problem(path, malformed(written)) : bounded(hours, path, scope);
      }
      const inherited = options.inherits === void 0 ? null : durationNamed(options.inherits, scope.outer);
      const resolved = inherited ?? declared;
      if (resolved === null) return problem(path, "must be set to a duration");
      return bounded(resolved, path, scope);
    }
  };
}
function count(options) {
  return {
    describe: () => ({
      kind: "count",
      doc: options.doc ?? null,
      absent: "default",
      default: options.default
    }),
    read(key, scope) {
      const path = dot(scope.path, key);
      if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: options.default };
      const value = scope.raw[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return problem(path, "must be a whole number, zero or more");
      }
      return { ok: true, value };
    }
  };
}
function text(options) {
  return {
    describe: () => ({
      kind: "text",
      doc: options.doc ?? null,
      absent: options.optional ? "null" : "problem",
      optional: options.optional
    }),
    read(key, scope) {
      const path = dot(scope.path, key);
      if (!Object.hasOwn(scope.raw, key)) {
        return options.optional ? { ok: true, value: null } : problem(path, "must be set");
      }
      const value = scope.raw[key];
      if (typeof value !== "string") return problem(path, "must be text");
      return { ok: true, value };
    }
  };
}
function mappedList(family, nouns, doc) {
  return {
    describe: () => ({ kind: "meanings", doc: doc ?? null, absent: "empty" }),
    read(key, scope) {
      const path = dot(scope.path, key);
      if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: [] };
      const value = scope.raw[key];
      if (!Array.isArray(value)) return problem(path, `must be a list of ${nouns.many}`);
      const names = scope.view.mapped[family];
      const problems = [];
      const listed2 = [];
      for (const [index, entry] of value.entries()) {
        const at2 = `${path}.${String(index)}`;
        const mapped = names.find((name) => name === entry);
        if (mapped === void 0) {
          problems.push({
            code: "settingInvalid",
            path: at2,
            message: `${JSON.stringify(entry)} is not ${nouns.one} this repository has mapped`
          });
          continue;
        }
        listed2.push(mapped);
      }
      return problems.length > 0 ? { ok: false, problems } : { ok: true, value: listed2 };
    }
  };
}
function meanings(options = {}) {
  return mappedList("labels", { one: "a meaning", many: "meanings" }, options.doc);
}
function section(fields, options = {}) {
  return {
    within: fields,
    describe: () => ({
      kind: "section",
      doc: options.doc ?? null,
      absent: "default",
      fields: describeSpec(fields)
    }),
    read(key, scope) {
      const path = dot(scope.path, key);
      const stated = Object.hasOwn(scope.raw, key) ? scope.raw[key] : {};
      if (!isRecord(stated)) return problem(path, "must be a mapping");
      const unknown = strangers(stated, Object.keys(fields), path);
      const read = readScope(fields, inner(stated, path, fields, scope));
      if (unknown.length === 0) return read;
      return { ok: false, problems: [...unknown, ...read.ok ? [] : read.problems] };
    }
  };
}
function block(fields, options = {}) {
  return {
    within: fields,
    describe: () => ({
      kind: "block",
      doc: options.doc ?? null,
      absent: "parked",
      fields: describeSpec(fields)
    }),
    read(key, scope) {
      const path = dot(scope.path, key);
      const parked = { ok: true, value: { enabled: false } };
      if (!Object.hasOwn(scope.raw, key)) return parked;
      const raw = scope.raw[key];
      if (!isRecord(raw)) return problem(path, "must be a mapping");
      if (Object.hasOwn(raw, "enabled") && typeof raw.enabled !== "boolean") {
        return problem(dot(path, "enabled"), "must be true or false");
      }
      if (raw.enabled !== true) return parked;
      const unknown = strangers(raw, ["enabled", ...Object.keys(fields)], path);
      const read = readScope(fields, inner(raw, path, fields, scope));
      if (unknown.length > 0) {
        return { ok: false, problems: [...unknown, ...read.ok ? [] : read.problems] };
      }
      if (!read.ok) return read;
      return { ok: true, value: { enabled: true, ...read.value } };
    }
  };
}

// ../core/src/report/finding.ts
function finding(severity, code, summary, subject, detail = []) {
  return { severity, code, summary, subject, detail };
}

// ../core/src/report/convert.ts
var REFUSAL_SEVERITY = {
  // Deliberate states. Nothing is wrong; nothing needs doing.
  killSwitch: "notice",
  capabilityDisabled: "notice",
  modeDisabled: "notice",
  itemBlocked: "notice",
  itemClosed: "notice",
  graceRunning: "info",
  activityCancelled: "notice",
  newerHumanChange: "notice",
  preconditionStale: "notice",
  // A maintainer must act: grant a permission or fix a configuration.
  permissionMissing: "problem",
  // Safe by default, but the default was reached by not knowing.
  humanOrderingUnknown: "problem",
  // Defects: unreachable in a correct system, so all of them are loud.
  wrongEntryPoint: "problem",
  preventiveGateUnavailable: "problem",
  invalidTimestamp: "problem",
  wrongActionClass: "problem",
  noWarning: "problem",
  warningRequestMismatch: "problem",
  invalidDestructivePlan: "problem",
  graceBelowFloor: "problem"
};
function verdictFinding(verdict, subject) {
  if (verdict.outcome === "apply") {
    return finding("info", "applied", "The write was permitted.", subject);
  }
  if (verdict.outcome === "record-only") {
    return finding("notice", verdict.code, verdict.reason, subject);
  }
  return finding(REFUSAL_SEVERITY[verdict.code], verdict.code, verdict.reason, subject);
}
function screenFinding(screen, subject) {
  return screen.ok ? finding("info", "screened", "The intent passed every screen.", subject) : finding("problem", screen.code, screen.reason, subject);
}
function explanationFinding(explanation, subject) {
  return finding("info", "capabilityExplained", explanation.summary, subject, explanation.detail);
}

// ../core/src/engine/normalize/payload.ts
function isRecord2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function labelNames(item) {
  const labels = item["labels"];
  if (!Array.isArray(labels)) return null;
  const names = [];
  for (const label of labels) {
    if (!isRecord2(label) || typeof label["name"] !== "string") return null;
    names.push(label["name"]);
  }
  return names;
}
function authorLogin(item) {
  const user = item["user"];
  if (!isRecord2(user)) return null;
  const login = user["login"];
  return typeof login === "string" && login.length > 0 ? login : null;
}
function senderOf(payload) {
  const sender = payload["sender"];
  if (!isRecord2(sender) || typeof sender["login"] !== "string") return null;
  return { login: sender["login"] };
}
function actionOf(payload) {
  const action = payload["action"];
  return typeof action === "string" && action.length > 0 ? action : null;
}
function labelAdded(payload) {
  if (payload["action"] !== "labeled") return null;
  const label = payload["label"];
  if (!isRecord2(label) || typeof label["name"] !== "string") return null;
  return label["name"];
}
function labelRemoved(payload) {
  if (payload["action"] !== "unlabeled") return null;
  const label = payload["label"];
  if (!isRecord2(label) || typeof label["name"] !== "string") return null;
  return label["name"];
}
function timestamp(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function repositoryOf(payload) {
  const repository = payload["repository"];
  if (!isRecord2(repository)) return null;
  const owner = repository["owner"];
  if (!isRecord2(owner) || typeof owner["login"] !== "string") return null;
  if (typeof repository["name"] !== "string") return null;
  return { owner: owner["login"], repo: repository["name"] };
}
function repositoryNamedBy(payload) {
  return isRecord2(payload) ? repositoryOf(payload) : null;
}

// ../core/src/engine/normalize/verdict.ts
var malformed2 = (code, detail) => ({
  kind: "malformed",
  code,
  detail
});

// ../core/src/engine/normalize/issue-comment.ts
function issueClosure(item) {
  return item["state"] === "closed" ? "closedByHuman" : null;
}
function commentOf(facts) {
  const comment = facts.payload["comment"];
  if (!isRecord2(comment)) return null;
  const user = comment["user"];
  const at2 = timestamp(comment["created_at"]);
  if (typeof comment["body"] !== "string" || !isRecord2(user) || at2 === null) return null;
  if (typeof user["login"] !== "string" || user["login"] === "") return null;
  return { body: comment["body"], by: user["login"], at: at2 };
}
function commandOf(facts, comment) {
  const issued = facts.action === "created" ? commandInComment(facts.config, comment.body) : null;
  return { issued, by: comment.by, at: comment.at };
}
var issueCommentNormalizer = {
  event: "issue_comment",
  itemKey: "issue",
  normalize(facts) {
    if (facts.item["pull_request"] !== void 0) {
      return malformed2(
        "commentUnreadable",
        "issue_comment: a comment on a pull request carries no merged state"
      );
    }
    const comment = commentOf(facts);
    if (comment === null) {
      return malformed2("commentUnreadable", "issue_comment: comment unreadable");
    }
    const delivered = deliveredGroups("issue_comment", "issue", {
      ...facts,
      command: commandOf(facts, comment)
    });
    if (!delivered.ok) return malformed2(delivered.code, delivered.detail);
    return {
      kind: "facts",
      facts: {
        kind: "issue",
        repository: facts.repository,
        item: { kind: "issue", number: facts.number },
        observedAt: facts.observedAt,
        trigger: {
          kind: "event",
          event: "issue_comment",
          ...facts.deliveryId === void 0 ? {} : { deliveryId: facts.deliveryId }
        },
        author: facts.author,
        actor: facts.actor,
        arrival: null,
        position: projectIssue({
          closedBy: issueClosure(facts.item),
          meanings: facts.meanings
        }),
        ...delivered.groups
      }
    };
  }
};

// ../core/src/engine/normalize/issues.ts
function issueClosure2(item) {
  return item["state"] === "closed" ? "closedByHuman" : null;
}
var issuesNormalizer = {
  event: "issues",
  itemKey: "issue",
  normalize(facts) {
    const delivered = deliveredGroups("issues", "issue", facts);
    if (!delivered.ok) return malformed2(delivered.code, delivered.detail);
    return {
      kind: "facts",
      facts: {
        kind: "issue",
        repository: facts.repository,
        item: { kind: "issue", number: facts.number },
        observedAt: facts.observedAt,
        trigger: {
          kind: "event",
          event: "issues",
          ...facts.deliveryId === void 0 ? {} : { deliveryId: facts.deliveryId }
        },
        author: facts.author,
        actor: facts.actor,
        arrival: facts.action === "opened" ? { kind: "opened" } : facts.action === "labeled" ? {
          kind: "label",
          change: "added",
          meaning: facts.arrivedMeaning,
          skill: facts.arrivedSkill
        } : facts.action === "unlabeled" ? {
          kind: "label",
          change: "removed",
          meaning: facts.removedMeaning,
          skill: facts.removedSkill
        } : null,
        position: projectIssue({
          closedBy: issueClosure2(facts.item),
          meanings: facts.meanings
        }),
        ...delivered.groups
      }
    };
  }
};

// ../core/src/engine/normalize/pull-request.ts
function prClosure(item) {
  if (item["merged"] === true) return "merged";
  return item["state"] === "closed" ? "closedByHuman" : null;
}
var pullRequestNormalizer = {
  event: "pull_request",
  itemKey: "pull_request",
  normalize(facts) {
    if (typeof facts.item["merged"] !== "boolean") {
      return malformed2("mergedMissing", "pull_request: merged missing");
    }
    const delivered = deliveredGroups("pull_request", "pullRequest", facts);
    if (!delivered.ok) return malformed2(delivered.code, delivered.detail);
    return {
      kind: "facts",
      facts: {
        kind: "pullRequest",
        repository: facts.repository,
        item: { kind: "pullRequest", number: facts.number },
        observedAt: facts.observedAt,
        trigger: {
          kind: "event",
          event: "pull_request",
          ...facts.deliveryId === void 0 ? {} : { deliveryId: facts.deliveryId }
        },
        author: facts.author,
        actor: facts.actor,
        position: projectPullRequest({
          closedBy: prClosure(facts.item),
          meanings: facts.meanings
        }),
        ...delivered.groups
      }
    };
  }
};

// ../core/src/engine/events.ts
var NORMALIZERS = {
  issues: issuesNormalizer,
  issue_comment: issueCommentNormalizer,
  pull_request: pullRequestNormalizer
};
function normalizeDelivery(event, payload, config, deliveryId) {
  if (!isWebhookProducer(event)) {
    return { kind: "ignored", event };
  }
  const normalizer = NORMALIZERS[event];
  if (!isRecord2(payload)) {
    return malformed2("payloadNotObject", `${event}: payload is not an object`);
  }
  const repository = repositoryOf(payload);
  if (repository === null) {
    return malformed2("repositoryUnreadable", `${event}: repository/owner missing`);
  }
  const itemKey = normalizer.itemKey;
  const item = payload[itemKey];
  if (!isRecord2(item)) {
    return malformed2("itemMissing", `${event}: "${itemKey}" missing`);
  }
  if (typeof item["number"] !== "number") {
    return malformed2("numberMissing", `${event}: item number missing`);
  }
  const names = labelNames(item);
  if (names === null) {
    return malformed2("labelsUnreadable", `${event}: labels unreadable`);
  }
  const observedAt = timestamp(item["updated_at"]);
  if (observedAt === null) {
    return malformed2("timestampUnreadable", `${event}: updated_at unreadable`);
  }
  const author = authorLogin(item);
  if (author === null) {
    return malformed2("authorUnreadable", `${event}: user.login unreadable`);
  }
  const action = actionOf(payload);
  if (action === null) {
    return malformed2("actionUnreadable", `${event}: action unreadable`);
  }
  const meanings2 = meaningsOfLabels(config, names);
  const added = labelAdded(payload);
  const removed = labelRemoved(payload);
  const arrivedMeaning = added === null ? null : meaningsOfLabels(config, [added])[0] ?? null;
  const removedMeaning = removed === null ? null : meaningsOfLabels(config, [removed])[0] ?? null;
  const skills3 = skillsOfLabels(config, names);
  const arrivedSkill = added === null ? null : skillsOfLabels(config, [added])[0] ?? null;
  const removedSkill = removed === null ? null : skillsOfLabels(config, [removed])[0] ?? null;
  return normalizer.normalize({
    repository,
    item,
    number: item["number"],
    author,
    meanings: meanings2,
    arrivedMeaning,
    removedMeaning,
    skills: skills3,
    arrivedSkill,
    removedSkill,
    actor: senderOf(payload),
    observedAt,
    ...deliveryId === void 0 ? {} : { deliveryId },
    action,
    payload,
    config
  });
}

// ../core/src/engine/invoke.ts
function toEngine(capability) {
  return capability;
}
function thrownDetail(thrown) {
  try {
    return thrown instanceof Error ? String(thrown.message) : String(thrown);
  } catch {
    return "an unprintable value";
  }
}
var SkipSignal = class {
  skipped = true;
};
function isSkipSignal(thrown) {
  try {
    return thrown instanceof SkipSignal;
  } catch {
    return false;
  }
}
var EngineHandle = class {
  constructor(declaration, facts, source) {
    this.declaration = declaration;
    this.facts = facts;
    this.source = source;
  }
  declaration;
  facts;
  source;
  explanations = [];
  violations = [];
  /** Declared resolvers whose source threw, as `name: detail`. */
  failures = [];
  /** Set once `ask` or `intent` ended the evaluation; intents after it are refused. */
  skipped = false;
  skip(summary, ...detail) {
    this.explanations.push({ capability: this.declaration.name, summary, detail });
    return [];
  }
  /** Ends the evaluation: the explanation is recorded, then the sentinel is thrown. */
  stop(summary, ...detail) {
    this.skip(summary, ...detail);
    this.skipped = true;
    throw new SkipSignal();
  }
  async ask(query, input) {
    const answer = await this.resolve(query, input);
    if (answer.ok) return answer.value;
    return this.stop(
      `Skipped: the ${query} resolver could not answer.`,
      `resolver reason: ${answer.reason}`,
      answer.detail
    );
  }
  intent(request) {
    const built = buildIntent(this.declaration.name, this.facts, request);
    if (built !== null) return built;
    const meaning = "meaning" in request.desired ? request.desired.meaning : "";
    return this.stop(
      `Skipped: no edge on the workflow map moves this item to ${meaning}.`,
      `from ${this.facts.position.kind === "conflict" ? "a conflicted position" : this.facts.position.state.meaning ?? "no position"}`
    );
  }
  async resolve(query, input) {
    if (!this.declaration.resolvers.includes(query)) {
      this.violations.push(query);
      return {
        ok: false,
        reason: "notConfigured",
        detail: `"${this.declaration.name}" did not declare resolver "${query}"`
      };
    }
    if (this.source === void 0) {
      return { ok: false, reason: "unavailable", detail: "no resolver source supplied" };
    }
    try {
      return await this.source(query, input);
    } catch (thrown) {
      const detail = thrownDetail(thrown);
      this.failures.push(`${query}: ${detail}`);
      return { ok: false, reason: "unavailable", detail };
    }
  }
  explain(explanation) {
    this.explanations.push(explanation);
  }
};
function screenTransition(intent, projection) {
  if (projection.kind === "conflict") {
    return {
      ok: false,
      code: "positionConflict",
      reason: `the observed item holds ${projection.positions.join(" and ")}; a conflicted position has no edge to move along`
    };
  }
  if (intent.desired.meaning === "blocked") {
    return {
      ok: false,
      code: "pauseNotCapabilityWritable",
      reason: "pausing an item withholds it from every capability, so only a human may set `blocked` (D79); a capability that must stop work needs the immediatePreventive gate (D54)"
    };
  }
  const wrongEntity = (meaning) => ({
    ok: false,
    code: "meaningWrongEntity",
    reason: `"${meaning}" is not ${intent.item.kind === "issue" ? "an issue" : "a pull request"} position`
  });
  const offMap = (from2, detail) => ({
    ok: false,
    code: "transitionNotOnMap",
    reason: `${from2 ?? "no position"} \u2192 ${intent.desired.meaning} for "${intent.desired.cause}" is not a documented edge (${detail})`
  });
  const from = projection.state.meaning;
  if (intent.item.kind === "issue") {
    if (!isIssueMeaning(intent.desired.meaning)) return wrongEntity(intent.desired.meaning);
    if (from !== null && !isIssueMeaning(from)) return wrongEntity(from);
    if (!isIssueCause(intent.desired.cause)) {
      return offMap(from, "not an issue-flow cause");
    }
    const verdict2 = canTransitionIssue({
      from,
      to: intent.desired.meaning,
      cause: intent.desired.cause
    });
    return verdict2.allowed ? { ok: true } : offMap(from, verdict2.code);
  }
  if (!isPrMeaning(intent.desired.meaning)) return wrongEntity(intent.desired.meaning);
  if (from !== null && !isPrMeaning(from)) return wrongEntity(from);
  if (!isPrCause(intent.desired.cause)) {
    return offMap(from, "not a pull-request-flow cause");
  }
  const verdict = canTransitionPr({
    from,
    to: intent.desired.meaning,
    cause: intent.desired.cause
  });
  return verdict.allowed ? { ok: true } : offMap(from, verdict.code);
}
function screenGrace(intent) {
  const destructive = INTENT_OPERATIONS[intent.operation].actionClassFloor === "clockTriggeredDestructive";
  const grace = intent.grace ?? null;
  if (destructive && grace === null) {
    return {
      ok: false,
      code: "graceMismatch",
      reason: `"${intent.operation}" is clock-triggered destructive, and such an intent must carry the grace terms the platform warns, waits and reports with (grace.md \xA71)`
    };
  }
  if (!destructive && grace !== null) {
    return {
      ok: false,
      code: "graceMismatch",
      reason: `"${intent.operation}" is not clock-triggered destructive, so the grace terms it carries name a warning and a notice the platform would never post (grace.md \xA71)`
    };
  }
  if (grace !== null && !(Number.isFinite(grace.hours) && grace.hours >= MIN_GRACE_HOURS)) {
    return {
      ok: false,
      code: "graceBelowFloor",
      reason: `grace period ${String(grace.hours)}h is below the ${String(MIN_GRACE_HOURS)}h floor (grace.md)`
    };
  }
  return { ok: true };
}
function screenIntent(intent, declaration, projection) {
  if (intent.capability !== declaration.name) {
    return {
      ok: false,
      code: "foreignCapability",
      reason: `intent attributed to "${intent.capability}" was returned by "${declaration.name}"`
    };
  }
  if (!declaration.intents.includes(intent.operation)) {
    return {
      ok: false,
      code: "undeclaredIntent",
      reason: `"${declaration.name}" did not declare intent "${intent.operation}"`
    };
  }
  if (!Number.isFinite(intent.cause.observedAt.getTime())) {
    return {
      ok: false,
      code: "invalidCause",
      reason: "the intent's cause carries an invalid timestamp"
    };
  }
  if (intent.idempotencyKey !== deriveIdempotencyKey(intent)) {
    return {
      ok: false,
      code: "idempotencyKeyMismatch",
      reason: "the intent's idempotency key is not the one this occasion derives"
    };
  }
  const grace = screenGrace(intent);
  if (!grace.ok) return grace;
  if (intent.operation === "applyMappedLabel") {
    if (!declaration.labels.includes(intent.desired.meaning)) {
      return {
        ok: false,
        code: "undeclaredMeaning",
        reason: `"${declaration.name}" did not declare label meaning "${intent.desired.meaning}"`
      };
    }
    if (projection === null) {
      return {
        ok: false,
        code: "authoritativePositionUnavailable",
        reason: "the authoritative current position is unavailable"
      };
    }
    return screenTransition(intent, projection);
  }
  return { ok: true };
}

// ../core/src/engine/change.ts
function describeChange(intent) {
  const module = OPERATIONS[intent.operation];
  return module.describeChange(intent);
}
function writeRequestFor(intent) {
  const facts = INTENT_OPERATIONS[intent.operation];
  return {
    capability: intent.capability,
    actionClass: facts.actionClassFloor,
    requiredPermissions: [facts.permission],
    cause: intent.cause.cause,
    causeObservedAt: intent.cause.observedAt,
    ...intent.evaluatedAt === void 0 ? {} : { evaluatedAt: intent.evaluatedAt },
    target: {
      item: `${intent.repository.owner}/${intent.repository.repo}#${String(intent.item.number)}`,
      change: describeChange(intent)
    }
  };
}
function wouldApplyFinding(intent, subject) {
  return finding(
    "info",
    "wouldApply",
    `dry-run: ${intent.capability} would ${intent.operation} on ${intent.repository.owner}/${intent.repository.repo}#${String(intent.item.number)} \u2014 ${describeChange(intent)}. Nothing was written.`,
    subject
  );
}

// ../core/src/engine/decide.ts
var NOT_THIS_RECORD = {
  outcome: "refuse",
  code: "preconditionStale",
  reason: "the intent names an item this record does not carry"
};
function namesTheRecord(intent, facts) {
  return intent.repository.owner === facts.repository.owner && intent.repository.repo === facts.repository.repo && intent.item.kind === facts.item.kind && intent.item.number === facts.item.number;
}
async function orderingFor(item, externals) {
  try {
    return { value: await externals.latestHumanChangeAt(item), defect: null };
  } catch (thrown) {
    return { value: "unknown", defect: thrownDetail(thrown) };
  }
}
function addressed(intent, config) {
  if (intent.operation !== "postManagedComment") return intent;
  const body = addressManagedComment(
    intent.desired.body,
    intent.desired.mention,
    config.principals
  );
  return body === intent.desired.body ? intent : { ...intent, desired: { ...intent.desired, body } };
}
function recordOf2(records) {
  const { request } = records;
  return {
    effectId: records.effectId,
    actionClass: request.actionClass,
    capability: request.capability,
    causeObservedAt: request.causeObservedAt.toISOString(),
    cause: request.cause,
    item: request.target.item,
    change: request.target.change,
    gracePeriodHours: records.gracePeriodHours,
    cancelledBy: records.cancelledBy,
    reversesWith: records.reversesWith
  };
}
function managedCommentFor(intent, records) {
  if (intent.operation === "postManagedComment") {
    return managedCommentOf(
      {
        capability: intent.capability,
        item: intent.item,
        kind: intent.desired.kind,
        topic: intent.desired.topic ?? ""
      },
      records === null ? void 0 : recordOf2(records)
    );
  }
  if ((intent.operation === "assign" || intent.operation === "unassign") && intent.desired.notice !== void 0) {
    return managedCommentOf({
      capability: intent.capability,
      item: intent.item,
      kind: "notice",
      topic: intent.desired.notice.topic
    });
  }
  return intent.grace === null ? null : managedCommentOf({
    capability: intent.capability,
    item: intent.item,
    kind: "notice",
    topic: intent.grace.topic ?? ""
  });
}
function warningEffectFor(act, grace) {
  return {
    capability: act.capability,
    repository: act.repository,
    item: act.item,
    operation: "postManagedComment",
    claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
    desired: { kind: "warning", topic: grace.topic ?? "", body: grace.warning.body },
    cause: act.cause,
    ...act.evaluatedAt === void 0 ? {} : { evaluatedAt: act.evaluatedAt },
    explanation: act.explanation,
    idempotencyKey: `${act.idempotencyKey}:warning`,
    grace: null
  };
}
async function recordedWarning(effectId, externals) {
  try {
    return { value: await externals.warningFor?.(effectId) ?? null, defect: null };
  } catch (thrown) {
    return { value: null, defect: thrownDetail(thrown) };
  }
}
function outcomeOf(intent, verdict, config, subject, records) {
  const effectSubject = {
    kind: "effect",
    capability: intent.capability,
    item: intent.item,
    operation: intent.operation
  };
  const findings = [];
  if (verdict.outcome !== "refuse") {
    findings.push(explanationFinding(intent.explanation, subject));
  }
  findings.push(verdictFinding(verdict, effectSubject));
  if (config.mode === "dry-run" && verdict.outcome === "record-only" && verdict.code === "modeRecordsOnly") {
    findings.push(wouldApplyFinding(intent, effectSubject));
  }
  return {
    findings,
    approved: verdict.outcome === "apply" ? { intent, managedComment: managedCommentFor(intent, records), records } : null
  };
}
async function gateIntent(value, declaration, facts, config, externals) {
  if (typeof value !== "object" || value === null) {
    return {
      findings: [
        screenFinding(
          {
            ok: false,
            code: "malformedIntent",
            reason: "the capability returned a malformed intent"
          },
          { kind: "capability", capability: declaration.name }
        )
      ],
      approved: null
    };
  }
  const intent = addressed(
    { ...value, evaluatedAt: new Date(facts.observedAt.getTime()) },
    config
  );
  const evaluatedAt = externals.evaluatedAt ?? facts.observedAt;
  const forApply = (approved) => ({
    ...approved,
    evaluatedAt: new Date(evaluatedAt.getTime())
  });
  const subject = {
    kind: "item",
    capability: declaration.name,
    item: intent.item
  };
  const screen = screenIntent(intent, declaration, facts.position);
  if (!screen.ok) {
    return { findings: [screenFinding(screen, subject)], approved: null };
  }
  if (!namesTheRecord(intent, facts)) {
    return {
      findings: [
        verdictFinding(NOT_THIS_RECORD, {
          kind: "effect",
          capability: declaration.name,
          item: intent.item,
          operation: intent.operation
        })
      ],
      approved: null
    };
  }
  const ordering = await orderingFor(intent.item, externals);
  const before = ordering.defect === null ? [] : [
    finding(
      "problem",
      "humanOrderingLookupFailed",
      `the human-change ordering lookup threw: ${ordering.defect}`,
      subject
    )
  ];
  const contextFor = (request) => ({
    killSwitchActive: externals.killSwitchActive,
    installationGrants: externals.installationGrants,
    latestHumanChangeAt: ordering.value,
    // A mode claim is judged against the native modes this record read.
    world: deriveWorld(facts.position, request.claims, modesOf(facts))
  });
  const said = (result) => ({
    findings: [...before, ...result.findings],
    approved: result.approved
  });
  const grace = intent.grace ?? null;
  if (grace === null) {
    const verdict2 = evaluateWrite(writeRequestFor(intent), config, contextFor(intent));
    return said(outcomeOf(forApply(intent), verdict2, config, subject, null));
  }
  const recorded = await recordedWarning(intent.idempotencyKey, externals);
  if (recorded.defect !== null) {
    return {
      findings: [
        ...before,
        finding(
          "problem",
          "warningLookupFailed",
          `the recorded-warning lookup threw, so nothing was warned and nothing acted: ${recorded.defect}`,
          subject
        )
      ],
      approved: null
    };
  }
  if (recorded.value === null) {
    const warning = warningEffectFor(intent, grace);
    const verdict2 = evaluateWrite(writeRequestFor(warning), config, contextFor(warning));
    return said(
      outcomeOf(forApply(warning), verdict2, config, subject, {
        effectId: intent.idempotencyKey,
        request: writeRequestFor(intent),
        gracePeriodHours: grace.hours,
        cancelledBy: grace.cancelledBy,
        reversesWith: grace.reversesWith
      })
    );
  }
  const verdict = evaluateDestructive(
    {
      request: writeRequestFor(intent),
      warning: recorded.value,
      // The platform decides what the capability's reported activity means.
      qualifyingActivitySinceWarning: activitySinceWarning(grace.activityAt, recorded.value)
    },
    config,
    contextFor(intent),
    facts.observedAt
  );
  return said(outcomeOf(forApply(intent), verdict, config, subject, null));
}
async function intentsFrom(capability, facts, view, handle) {
  try {
    const intents = await capability.evaluate(
      facts,
      view,
      handle
    );
    return Array.isArray(intents) ? { intents: [...intents], defect: null } : { intents: [], defect: "the capability returned a non-array intent collection" };
  } catch (thrown) {
    if (isSkipSignal(thrown)) return { intents: [], defect: null };
    return { intents: [], defect: thrownDetail(thrown) };
  }
}
function readInput(input, config) {
  if (input.kind === "facts") {
    return { repository: input.facts.repository, facts: input.facts, findings: [] };
  }
  const normalized = normalizeDelivery(input.event, input.payload, config, input.deliveryId);
  if (normalized.kind === "facts") {
    return {
      repository: normalized.facts.repository,
      facts: normalized.facts,
      findings: []
    };
  }
  const refusal2 = normalized.kind === "ignored" ? finding("info", "deliveryIgnored", `event "${normalized.event}" carries no facts`, {
    kind: "repository"
  }) : finding("problem", normalized.code, normalized.detail, { kind: "repository" });
  return { repository: input.repository, facts: null, findings: [refusal2] };
}
async function decide(input, config, capabilities2, externals) {
  const read = readInput(input, config);
  const findings = [...read.findings];
  const approved = [];
  const facts = read.facts;
  if (facts !== null) {
    for (const capability of capabilities2) {
      const declaration = capability.declaration;
      if (config.capabilities[declaration.name]?.enabled !== true) continue;
      if (!declaration.facts.includes(facts.kind)) continue;
      const unread = declaration.needs[facts.kind].filter(
        (group) => factGroupUnread(facts, group)
      );
      if (unread.length > 0) {
        findings.push(
          finding(
            "info",
            "factsUnread",
            `"${declaration.name}" needs ${unread.join(", ")}, which this producer did not read`,
            { kind: "capability", capability: declaration.name }
          )
        );
        continue;
      }
      if (declaration.closed !== true && closureOf(facts.position) !== null) continue;
      const handle = new EngineHandle(declaration, facts, externals.resolve);
      const view = projectCapabilityView(declaration, config);
      const evaluated = await intentsFrom(capability, facts, view, handle);
      for (const explanation of handle.explanations) {
        findings.push(
          explanationFinding(explanation, {
            kind: "capability",
            capability: declaration.name
          })
        );
      }
      for (const resolver of handle.violations) {
        findings.push(
          finding(
            "problem",
            "undeclaredResolver",
            `"${declaration.name}" asked for undeclared resolver "${resolver}"`,
            { kind: "capability", capability: declaration.name }
          )
        );
      }
      for (const failure of handle.failures) {
        findings.push(
          finding(
            "problem",
            "resolverFailed",
            `the resolver failed answering "${declaration.name}" \u2014 ${failure}`,
            { kind: "capability", capability: declaration.name }
          )
        );
      }
      if (evaluated.defect !== null) {
        findings.push(
          finding(
            "problem",
            "capabilityFailed",
            `"${declaration.name}" failed during evaluation: ${evaluated.defect}`,
            { kind: "capability", capability: declaration.name }
          )
        );
      }
      if (handle.skipped && evaluated.intents.length > 0) {
        findings.push(
          finding(
            "problem",
            "intentsAfterSkip",
            `"${declaration.name}" caught the platform's skip and returned ${String(evaluated.intents.length)} intents, which are refused`,
            { kind: "capability", capability: declaration.name }
          )
        );
        continue;
      }
      for (const intent of evaluated.intents) {
        const gated = await gateIntent(intent, declaration, facts, config, externals);
        findings.push(...gated.findings);
        if (gated.approved !== null) approved.push(gated.approved);
      }
    }
  }
  return {
    report: {
      revision: config.revision,
      mode: config.mode,
      repository: read.repository,
      findings
    },
    approved,
    item: facts === null ? null : facts.item
  };
}

// src/store/inbox.ts
function assertDeliveryGuid(value) {
  if (asDeliveryGuid(value) === void 0) {
    throw new TypeError("deliveryId must be a valid GitHub delivery GUID");
  }
}
function assertPayload(value) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("payload must be bytes");
  }
}
function assertPayloadDigest(value) {
  if (value.length !== 64 || !/^[a-f0-9]+$/.test(value)) {
    throw new TypeError("payloadDigest must be a lowercase SHA-256 digest");
  }
}
function assertAttemptCap(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("maxAttempts must be a positive integer");
  }
}
function payloadDigest(payload) {
  return createHash3("sha256").update(payload).digest("hex");
}
function refusedCompletion(delivery, input) {
  if (delivery === void 0 || delivery.event_name !== input.eventName || delivery.payload_digest !== input.payloadDigest) {
    return { outcome: "identityMismatch" };
  }
  if (delivery.state === "done") return { outcome: "alreadyCompleted" };
  if (delivery.claim_token !== input.claimToken) return { outcome: "notOwned" };
  return void 0;
}
var Inbox = class {
  db;
  injectFault;
  constructor(db, injectFault) {
    this.db = db;
    this.injectFault = injectFault;
  }
  // ── Durable webhook intake ─────────────────────────────────────
  /**
   * Atomically persist a verified delivery's identity and exact bytes before a
   * receiver acknowledges it. Neither a duplicate nor a conflict mutates the first.
   */
  acceptDelivery(input) {
    assertDeliveryGuid(input.deliveryId);
    assertNonEmpty(input.eventName, "eventName");
    assertPayload(input.payload);
    assertUtcInstant(input.receivedAt, "receivedAt");
    const digest = payloadDigest(input.payload);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.db.prepare(
        `
                    INSERT INTO seen_delivery (
                        delivery_id, event_name, payload, payload_digest,
                        received_at, state, claim_worker, claim_token,
                        claimed_at, completed_at, attempts, retry_not_before
                    ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, 0, NULL)
                    ON CONFLICT(delivery_id) DO NOTHING
                `
      ).run(input.deliveryId, input.eventName, input.payload, digest, input.receivedAt);
      let result;
      if (inserted.changes === 1) {
        result = {
          outcome: "accepted",
          state: "pending",
          payloadDigest: digest
        };
      } else {
        const existing = this.db.prepare(
          `
                        SELECT event_name, payload_digest, state
                        FROM seen_delivery
                        WHERE delivery_id = ?
                    `
        ).get(input.deliveryId);
        const eventNameMismatch = existing.event_name !== input.eventName;
        const payloadMismatch = existing.payload_digest !== digest;
        result = eventNameMismatch || payloadMismatch ? {
          outcome: "conflict",
          state: existing.state,
          eventNameMismatch,
          payloadMismatch
        } : {
          outcome: "duplicate",
          state: existing.state,
          payloadDigest: existing.payload_digest
        };
      }
      this.injectFault("intake:accepted");
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw error;
    }
  }
  /**
   * Claim the oldest ELIGIBLE delivery, or atomically take over one stale claim.
   * The generated token, not the worker name, proves ownership. Eligibility skips a row waiting out a backoff and a dead-lettered one, inside the claiming statement.
   */
  claimNextDelivery(worker, now, staleBefore) {
    assertNonEmpty(worker, "worker");
    assertUtcInstant(now, "now");
    assertUtcInstant(staleBefore, "staleBefore");
    const row2 = this.db.prepare(
      `
                UPDATE seen_delivery
                SET state = 'processing',
                    claim_worker = ?,
                    claim_token = lower(hex(randomblob(32))),
                    claimed_at = ?,
                    retry_not_before = NULL
                WHERE delivery_id = (
                    SELECT delivery_id
                    FROM seen_delivery
                    WHERE (state = 'pending'
                            AND (retry_not_before IS NULL OR retry_not_before <= ?))
                       OR (state = 'processing' AND claimed_at <= ?)
                    ORDER BY received_at, delivery_id
                    LIMIT 1
                )
                RETURNING delivery_id, event_name, payload, payload_digest,
                          received_at, claim_token, attempts
            `
    ).get(worker, now, now, staleBefore);
    if (row2 === void 0) return void 0;
    return {
      deliveryId: row2.delivery_id,
      eventName: row2.event_name,
      payload: Buffer.from(row2.payload),
      payloadDigest: row2.payload_digest,
      receivedAt: row2.received_at,
      worker,
      claimedAt: now,
      claimToken: row2.claim_token,
      attempts: row2.attempts
    };
  }
  /**
   * Complete only this token's current claim, in one transaction (D173).
   * A delivery already done answers `alreadyCompleted` whatever token asks: the
   * committing token is not kept, so the store knows only that it finished.
   */
  completeDelivery(input) {
    assertDeliveryGuid(input.deliveryId);
    assertNonEmpty(input.eventName, "eventName");
    assertPayloadDigest(input.payloadDigest);
    assertNonEmpty(input.claimToken, "claimToken");
    assertUtcInstant(input.completedAt, "completedAt");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const delivery = this.db.prepare(
        `
                SELECT event_name, payload_digest, state, claim_token
                FROM seen_delivery
                WHERE delivery_id = ?
            `
      ).get(input.deliveryId);
      const refusal2 = refusedCompletion(delivery, input);
      if (refusal2 !== void 0) {
        this.db.exec("ROLLBACK");
        return refusal2;
      }
      const completed = this.db.prepare(
        `
                UPDATE seen_delivery
                SET state = 'done', payload = NULL, claim_worker = NULL,
                    claim_token = NULL, claimed_at = NULL, completed_at = ?
                WHERE delivery_id = ? AND event_name = ? AND payload_digest = ?
                  AND state = 'processing' AND claim_token = ?
            `
      ).run(
        input.completedAt,
        input.deliveryId,
        input.eventName,
        input.payloadDigest,
        input.claimToken
      );
      if (completed.changes !== 1) {
        throw new Error("delivery ownership changed under its write transaction");
      }
      this.injectFault("finalize:deliveryCompleted");
      this.db.exec("COMMIT");
      this.injectFault("finalize:committed");
      return { outcome: "completed" };
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw error;
    }
  }
  /** Return only this token's in-flight work to the pending queue. */
  releaseDelivery(deliveryId, claimToken) {
    assertDeliveryGuid(deliveryId);
    assertNonEmpty(claimToken, "claimToken");
    const result = this.db.prepare(
      `
                UPDATE seen_delivery
                SET state = 'pending', claim_worker = NULL,
                    claim_token = NULL, claimed_at = NULL
                WHERE delivery_id = ? AND state = 'processing' AND claim_token = ?
            `
    ).run(deliveryId, claimToken);
    return result.changes === 1 ? { outcome: "released" } : { outcome: "notOwned" };
  }
  /**
   * Count one failed attempt, then either schedule the retry or dead-letter it — one
   * statement, so the count and the state it decides can never disagree. The cap is compared against the INCREMENTED count, and is a parameter: the store owns no policy.
   */
  releaseDeliveryAfterFailure(input) {
    assertDeliveryGuid(input.deliveryId);
    assertNonEmpty(input.claimToken, "claimToken");
    assertUtcInstant(input.failedAt, "failedAt");
    assertUtcInstant(input.retryNotBefore, "retryNotBefore");
    assertAttemptCap(input.maxAttempts);
    const row2 = this.db.prepare(
      `
                UPDATE seen_delivery
                SET attempts = attempts + 1,
                    claim_worker = NULL,
                    claim_token = NULL,
                    claimed_at = NULL,
                    state = CASE WHEN attempts + 1 >= $cap THEN 'failed' ELSE 'pending' END,
                    completed_at = CASE WHEN attempts + 1 >= $cap THEN $failedAt ELSE NULL END,
                    retry_not_before =
                        CASE WHEN attempts + 1 >= $cap THEN NULL ELSE $retryNotBefore END
                WHERE delivery_id = $deliveryId
                  AND state = 'processing'
                  AND claim_token = $claimToken
                RETURNING state, attempts, retry_not_before
            `
    ).get({
      $cap: input.maxAttempts,
      $failedAt: input.failedAt,
      $retryNotBefore: input.retryNotBefore,
      $deliveryId: input.deliveryId,
      $claimToken: input.claimToken
    });
    if (row2 === void 0) return { outcome: "notOwned" };
    if (row2.state === "failed") {
      return { outcome: "deadLettered", attempts: row2.attempts };
    }
    return {
      outcome: "retryScheduled",
      attempts: row2.attempts,
      retryNotBefore: input.retryNotBefore
    };
  }
  /**
   * Every dead-lettered delivery, in stable dead-letter then GUID order.
   * Identity and attempt count only; the payload leaves the store through a claim.
   */
  deadLetteredDeliveries() {
    const rows = this.db.prepare(
      `
                SELECT delivery_id, event_name, payload_digest, received_at,
                       attempts, completed_at
                FROM seen_delivery
                WHERE state = 'failed'
                ORDER BY completed_at, delivery_id
            `
    ).all();
    return rows.map((row2) => ({
      deliveryId: row2.delivery_id,
      eventName: row2.event_name,
      payloadDigest: row2.payload_digest,
      receivedAt: row2.received_at,
      attempts: row2.attempts,
      failedAt: row2.completed_at
    }));
  }
  redriveDelivery(deliveryId) {
    assertDeliveryGuid(deliveryId);
    return this.db.prepare(
      `
                    UPDATE seen_delivery
                    SET state = 'pending', claim_worker = NULL, claim_token = NULL,
                        claimed_at = NULL, completed_at = NULL, attempts = 0,
                        retry_not_before = NULL
                    WHERE delivery_id = ? AND state = 'failed'
                `
    ).run(deliveryId).changes === 1;
  }
  /** Requeue stale processing rows without exposing their payloads. */
  requeueStuckDeliveries(claimedBefore) {
    assertUtcInstant(claimedBefore, "claimedBefore");
    const rows = this.db.prepare(
      `
                UPDATE seen_delivery
                SET state = 'pending', claim_worker = NULL,
                    claim_token = NULL, claimed_at = NULL
                WHERE state = 'processing' AND claimed_at <= ?
                RETURNING delivery_id
            `
    ).all(claimedBefore);
    return rows.map((row2) => row2.delivery_id).sort();
  }
  /** How many deliveries sit in each state, and the oldest done one still kept (D168). */
  counts() {
    const row2 = this.db.prepare(
      `
                SELECT COUNT(CASE WHEN state = 'pending' THEN 1 END) AS pending,
                       COUNT(CASE WHEN state = 'processing' THEN 1 END) AS processing,
                       COUNT(CASE WHEN state = 'done' THEN 1 END) AS done,
                       COUNT(CASE WHEN state = 'failed' THEN 1 END) AS failed,
                       MIN(CASE WHEN state = 'done' THEN completed_at END) AS oldest_done
                FROM seen_delivery
            `
    ).get();
    return {
      pending: row2.pending,
      processing: row2.processing,
      done: row2.done,
      failed: row2.failed,
      oldestDone: row2.oldest_done
    };
  }
  /** The newest delivery received, and when it finished (D168). */
  newestDelivery() {
    const row2 = this.db.prepare(
      `
                SELECT received_at, completed_at FROM seen_delivery
                ORDER BY received_at DESC, delivery_id DESC
                LIMIT 1
            `
    ).get();
    return row2 === void 0 ? null : { receivedAt: row2.received_at, completedAt: row2.completed_at };
  }
  /**
   * Delete only completed delivery identities past the retention boundary.
   * Pending and processing payloads are never eligible, regardless of age.
   */
  pruneCompletedDeliveries(before) {
    assertUtcInstant(before, "before");
    return this.db.prepare(
      `
                DELETE FROM seen_delivery
                WHERE state = 'done' AND completed_at <= ?
            `
    ).run(before).changes;
  }
};

// src/store/ledger.ts
var CLOSING = "('landed','refused','abandoned','unsent')";
var STILL_OPEN = `
    NOT EXISTS (
        SELECT 1 FROM effect_fact closing
        WHERE closing.effect_id = sent.effect_id AND closing.seq = sent.seq
          AND closing.kind IN ${CLOSING} AND closing.fact_id > sent.fact_id
    )`;
var LATEST_SEND = `
    NOT EXISTS (
        SELECT 1 FROM effect_fact newer
        WHERE newer.effect_id = sent.effect_id AND newer.seq = sent.seq
          AND newer.kind = 'sent' AND newer.fact_id > sent.fact_id
    )`;
var ATTEMPTS_AT = `
    (SELECT COUNT(CASE WHEN spent.kind = 'sent' THEN 1 END)
          - COUNT(CASE WHEN spent.kind = 'unsent' THEN 1 END)
     FROM effect_fact spent
     WHERE spent.effect_id = sent.effect_id AND spent.seq = sent.seq)`;
var PROMISED_AT = `
    CASE WHEN json_valid(warned.payload)
         THEN json_extract(warned.payload, '$.earliestActionAt') END`;
var PROMISE_AHEAD = `
    SELECT warned.effect_id FROM effect_fact warned
    WHERE warned.kind = 'warned' AND ${PROMISED_AT} > $before`;
var ALREADY_LANDED = `
    SELECT landed.effect_id FROM effect_fact landed
    WHERE landed.kind = 'landed' AND landed.seq >= 1`;
function firedFirst(left, right) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left < right ? -1 : 1;
}
var spelled = (repository) => `${repository.owner}/${repository.repo}`;
function refOf(column) {
  const cut = column.indexOf("/");
  return { owner: column.slice(0, cut), repo: column.slice(cut + 1) };
}
function factOf(row2) {
  return {
    effectId: row2.effect_id,
    seq: row2.seq,
    kind: row2.kind,
    at: row2.at,
    revision: row2.revision,
    capability: row2.capability,
    repository: refOf(row2.repository),
    item: { kind: row2.item_kind, number: row2.item_number },
    verb: row2.verb,
    login: row2.login,
    code: row2.code,
    detail: row2.detail,
    payload: row2.payload
  };
}
function warningOf(effectId, payload) {
  if (payload === null) return null;
  let snapshot;
  try {
    snapshot = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return null;
  return { ...snapshot, effectId };
}
var Ledger = class {
  db;
  constructor(db) {
    this.db = db;
  }
  // ── Facts ───────────────────────────────────────────────────────
  /**
   * Append one fact. A second `warned` for the same effect appends nothing (D162).
   * One statement, so the first warning binds even against a concurrent writer.
   */
  record(fact) {
    assertUtcInstant(fact.at, "at");
    assertNonEmpty(fact.effectId, "effectId");
    this.db.prepare(
      `
                INSERT INTO effect_fact (
                    effect_id, seq, kind, at, revision, capability,
                    repository, item_kind, item_number, verb, login, code, detail, payload
                )
                SELECT $effectId, $seq, $kind, $at, $revision, $capability,
                       $repository, $itemKind, $itemNumber, $verb, $login, $code, $detail, $payload
                WHERE $kind != 'warned'
                   OR NOT EXISTS (
                        SELECT 1 FROM effect_fact
                        WHERE effect_id = $effectId AND kind = 'warned'
                   )
            `
    ).run({
      $effectId: fact.effectId,
      $seq: fact.seq,
      $kind: fact.kind,
      $at: fact.at,
      $revision: fact.revision,
      $capability: fact.capability,
      $repository: spelled(fact.repository),
      $itemKind: fact.item.kind,
      $itemNumber: fact.item.number,
      $verb: fact.verb,
      $login: fact.login,
      $code: fact.code,
      $detail: fact.detail,
      $payload: fact.payload
    });
  }
  /** One effect's facts in ledger order — the fold's input, and the operator's. */
  factsOf(effectId) {
    const rows = this.db.prepare("SELECT * FROM effect_fact WHERE effect_id = ? ORDER BY fact_id").all(effectId);
    return rows.map(factOf);
  }
  stateOf(effectId, planLength) {
    return fold(this.factsOf(effectId), planLength);
  }
  /** The sweep's worklist — every open send at or before `before`, oldest first. */
  open(before) {
    assertUtcInstant(before, "before");
    const rows = this.db.prepare(
      `
                SELECT sent.effect_id, sent.repository, sent.seq, sent.payload,
                       sent.at, sent.revision, ${ATTEMPTS_AT} AS attempts
                FROM effect_fact sent
                WHERE sent.kind = 'sent' AND sent.at <= ?
                  AND ${STILL_OPEN} AND ${LATEST_SEND}
                ORDER BY sent.at, sent.fact_id
            `
    ).all(before);
    return rows.map((row2) => ({
      effectId: row2.effect_id,
      repository: refOf(row2.repository),
      seq: row2.seq,
      payload: row2.payload,
      attempts: row2.attempts,
      at: row2.at,
      revision: row2.revision
    }));
  }
  /** How many sends nothing has closed, and when the oldest of them was sent (D168). */
  stillOpen() {
    const row2 = this.db.prepare(
      `
                SELECT COUNT(*) AS open_sends, MIN(sent.at) AS oldest
                FROM effect_fact sent
                WHERE sent.kind = 'sent' AND ${STILL_OPEN} AND ${LATEST_SEND}
            `
    ).get();
    return { count: row2.open_sends, oldest: row2.oldest };
  }
  /** Every effect with a fact on one item, oldest first — where an explanation starts (D163). */
  effectsOn(repository, item) {
    const rows = this.db.prepare(
      `
                SELECT effect_id FROM effect_fact
                WHERE repository = ? AND item_kind = ? AND item_number = ?
                GROUP BY effect_id
                ORDER BY MIN(fact_id)
            `
    ).all(spelled(repository), item.kind, item.number);
    return rows.map((row2) => row2.effect_id);
  }
  /** Every completed call the platform made on one item — what GitHub's actor cannot say (D159). */
  landedOn(repository, item) {
    const rows = this.db.prepare(
      `
                SELECT verb, login, at FROM effect_fact
                WHERE kind = 'landed'
                  AND repository = ? AND item_kind = ? AND item_number = ?
                ORDER BY at, fact_id
            `
    ).all(spelled(repository), item.kind, item.number);
    return rows.map((row2) => ({ verb: row2.verb, login: row2.login, at: row2.at }));
  }
  /** The warning standing for one effect: the earliest, because the first binds (D162). */
  warningFor(effectId) {
    const row2 = this.db.prepare(
      `
                SELECT payload FROM effect_fact
                WHERE effect_id = ? AND kind = 'warned'
                ORDER BY fact_id LIMIT 1
            `
    ).get(effectId);
    return row2 === void 0 ? null : warningOf(effectId, row2.payload);
  }
  /** The warnings promising an action still ahead of `now`, and the earliest due (D168). */
  standingWarnings(now) {
    assertUtcInstant(now, "now");
    const row2 = this.db.prepare(
      `
                SELECT COUNT(*) AS standing, MIN(${PROMISED_AT}) AS next_due
                FROM effect_fact warned
                WHERE warned.kind = 'warned' AND ${PROMISED_AT} > $now
                  AND warned.effect_id NOT IN (${ALREADY_LANDED})
            `
    ).get({ $now: now });
    return { count: row2.standing, nextDue: row2.next_due };
  }
  /** Append one pass's verdict on one item (D163). */
  decide(decision) {
    assertUtcInstant(decision.at, "at");
    assertNonEmpty(decision.passId, "passId");
    this.db.prepare(
      `
                INSERT INTO decision (
                    pass_id, source, source_id, at, repository, item_kind, item_number,
                    capability, verdict, code, detail, effect_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
    ).run(
      decision.passId,
      decision.source,
      decision.sourceId,
      decision.at,
      spelled(decision.repository),
      decision.item.kind,
      decision.item.number,
      decision.capability,
      decision.verdict,
      decision.code,
      decision.detail,
      decision.effectId
    );
  }
  decisionsOn(repository, item) {
    const rows = this.db.prepare(
      `
                SELECT * FROM decision
                WHERE repository = ? AND item_kind = ? AND item_number = ?
                ORDER BY at, rowid
            `
    ).all(spelled(repository), item.kind, item.number);
    return rows.map((row2) => ({
      passId: row2.pass_id,
      source: row2.source,
      sourceId: row2.source_id,
      at: row2.at,
      repository: refOf(row2.repository),
      item: { kind: row2.item_kind, number: row2.item_number },
      capability: row2.capability,
      verdict: row2.verdict,
      code: row2.code,
      detail: row2.detail,
      effectId: row2.effect_id
    }));
  }
  /** How many decisions each verdict took after `since`, in verdict order (D168). */
  verdictsSince(since2) {
    assertUtcInstant(since2, "since");
    const rows = this.db.prepare(
      `
                SELECT verdict, COUNT(*) AS taken FROM decision
                WHERE at > ?
                GROUP BY verdict ORDER BY verdict
            `
    ).all(since2);
    return rows.map((row2) => ({ verdict: row2.verdict, count: row2.taken }));
  }
  /** How many decisions after `since` carry one of `codes`. */
  unreadableSince(since2, codes) {
    assertUtcInstant(since2, "since");
    if (codes.length === 0) return 0;
    const row2 = this.db.prepare(
      `
                SELECT COUNT(*) AS refused FROM decision
                WHERE at > ? AND code IN (${codes.map(() => "?").join(", ")})
            `
    ).get(since2, ...codes);
    return row2.refused;
  }
  /** Managed comments landed after `since`; the client's own ceiling counts attempts (D193). */
  commentsSince(since2) {
    assertUtcInstant(since2, "since");
    const row2 = this.db.prepare(
      `
                SELECT COUNT(*) AS created FROM effect_fact
                WHERE kind = 'landed' AND verb = 'postComment' AND at > ?
            `
    ).get(since2);
    return row2.created;
  }
  // ── Snapshots ───────────────────────────────────────────────────
  /** One item's last read, or `null` where this repository has none (D193). */
  snapshotOf(repository, item) {
    const row2 = this.db.prepare(
      `
                SELECT updated_at, read_at, facts FROM item_snapshot
                WHERE repository = ? AND item_kind = ? AND item_number = ?
            `
    ).get(spelled(repository), item.kind, item.number);
    return row2 === void 0 ? null : { item, updatedAt: row2.updated_at, readAt: row2.read_at, facts: row2.facts };
  }
  /** Write one item's read, replacing whatever stood for it (D193). */
  putSnapshot(repository, snapshot) {
    assertUtcInstant(snapshot.updatedAt, "updatedAt");
    assertUtcInstant(snapshot.readAt, "readAt");
    this.db.prepare(
      `
                INSERT INTO item_snapshot VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(repository, item_kind, item_number) DO UPDATE SET
                    updated_at = excluded.updated_at,
                    read_at = excluded.read_at,
                    facts = excluded.facts
            `
    ).run(
      spelled(repository),
      snapshot.item.kind,
      snapshot.item.number,
      snapshot.updatedAt,
      snapshot.readAt,
      snapshot.facts
    );
  }
  /**
   * Drop every read of this repository for an item `numbers` does not carry (D193).
   * Only a COMPLETE list may say so: a firing that read part of one knows nothing about the rest.
   */
  dropSnapshotsNotIn(repository, numbers) {
    return this.db.prepare(
      `
                DELETE FROM item_snapshot
                WHERE repository = $repository
                  AND item_number NOT IN (SELECT value FROM json_each($numbers))
            `
    ).run({ $repository: spelled(repository), $numbers: JSON.stringify(numbers) }).changes;
  }
  /** How many reads each repository holds, and the oldest of them (D168). */
  snapshots() {
    const rows = this.db.prepare(
      `
                SELECT repository, COUNT(*) AS held, MIN(read_at) AS oldest
                FROM item_snapshot GROUP BY repository ORDER BY repository
            `
    ).all();
    return rows.map((row2) => ({
      repository: refOf(row2.repository),
      count: row2.held,
      oldest: row2.oldest
    }));
  }
  // ── Claims (lock) ───────────────────────────────────────────────
  /**
   * One-winner LEASE on an effect, with atomic stale takeover so a crashed holder
   * cannot deadlock it. Non-contention failures throw, so `false` strictly means a live worker holds it. A lease can still be stolen from a live worker (D41).
   */
  claim(effectId, worker, now, staleBefore) {
    assertUtcInstant(now, "now");
    assertUtcInstant(staleBefore, "staleBefore");
    const result = this.db.prepare(
      `
                INSERT INTO effect_claim VALUES (?, ?, ?)
                ON CONFLICT(effect_id) DO UPDATE SET worker = excluded.worker, at = excluded.at
                WHERE effect_claim.at <= ?
            `
    ).run(effectId, worker, now, staleBefore);
    return result.changes === 1;
  }
  /**
   * Release a claim on clean completion — deletes only the caller's OWN row, so
   * releasing after your lease was stolen is a safe no-op.
   */
  release(effectId, worker) {
    const result = this.db.prepare("DELETE FROM effect_claim WHERE effect_id = ? AND worker = ?").run(effectId, worker);
    return result.changes === 1;
  }
  // ── Schedules ───────────────────────────────────────────────────
  /** Idempotent: re-declaring an existing schedule id is a no-op. */
  schedule(scheduleId, dueAt, effect) {
    assertUtcInstant(dueAt, "dueAt");
    this.db.prepare(
      "INSERT OR IGNORE INTO schedule VALUES (?, ?, ?, 'pending', NULL, NULL, NULL, NULL)"
    ).run(scheduleId, dueAt, effect);
  }
  /**
   * Atomically claim every due pending schedule and return the claimed rows.
   * A restart mid-processing does NOT re-fire a running schedule; redriving stuck `running` rows is `requeueStuck`, deliberately not this method.
   */
  claimDue(now) {
    assertUtcInstant(now, "now");
    const rows = this.db.prepare(
      `
                UPDATE schedule
                SET status = 'running',
                    claimed_at = ?,
                    claim_token = lower(hex(randomblob(16)))
                WHERE status = 'pending' AND due_at <= ?
                RETURNING schedule_id, due_at, effect, claim_token, resume_after, started_at
            `
    ).all(now, now);
    return rows.sort((left, right) => firedFirst(left.started_at, right.started_at)).map((r) => ({
      scheduleId: r.schedule_id,
      dueAt: r.due_at,
      effect: r.effect,
      claimToken: r.claim_token,
      resumeAfter: r.resume_after
    }));
  }
  /** Complete a firing, and only for the token that claimed it. */
  scheduleDone(scheduleId, claimToken) {
    const result = this.db.prepare(
      `
                UPDATE schedule
                SET status = 'done', claimed_at = NULL, claim_token = NULL
                WHERE schedule_id = ? AND status = 'running' AND claim_token = ?
            `
    ).run(scheduleId, claimToken);
    return result.changes === 1;
  }
  /**
   * Complete this firing and arm the next one, in one statement: `schedule()` is
   * `INSERT OR IGNORE`, so a completed sweep could never come round again, and a crash between two statements would lose the schedule or strand the claim.
   * The cursor and the firing's start ride on the due date; a `null` start leaves the row's own, so a firing that read nothing keeps its place in the order (D170, D192).
   */
  scheduleAgain(scheduleId, claimToken, dueAt, resumeAfter, startedAt2) {
    assertUtcInstant(dueAt, "dueAt");
    if (startedAt2 !== null) assertUtcInstant(startedAt2, "startedAt");
    const result = this.db.prepare(
      `
                UPDATE schedule
                SET status = 'pending', due_at = ?, claimed_at = NULL, claim_token = NULL,
                    resume_after = ?, started_at = COALESCE(?, started_at)
                WHERE schedule_id = ? AND status = 'running' AND claim_token = ?
            `
    ).run(dueAt, resumeAfter, startedAt2, scheduleId, claimToken);
    return result.changes === 1;
  }
  /**
   * The sweep's redrive: atomically return stuck `running` schedules to `pending`.
   * Stuckness is claim age, never due time, so a backlog catch-up is not stolen from. A slow-but-alive handler can fire twice, so effects still need D41's contract (D43).
   */
  requeueStuck(claimedBefore) {
    assertUtcInstant(claimedBefore, "claimedBefore");
    const rows = this.db.prepare(
      `
                UPDATE schedule
                SET status = 'pending', claimed_at = NULL, claim_token = NULL
                WHERE status = 'running' AND claimed_at <= ?
                RETURNING schedule_id, due_at, effect
            `
    ).all(claimedBefore);
    return rows.map((r) => ({
      scheduleId: r.schedule_id,
      dueAt: r.due_at,
      effect: r.effect
    }));
  }
  /** Every schedule row: where it stands, when it is due, and the claim on it (D168). */
  schedules() {
    const rows = this.db.prepare(
      `
                SELECT schedule_id, due_at, effect, status, claimed_at
                FROM schedule ORDER BY schedule_id
            `
    ).all();
    return rows.map((r) => ({
      scheduleId: r.schedule_id,
      dueAt: r.due_at,
      effect: r.effect,
      status: r.status,
      claimedAt: r.claimed_at
    }));
  }
  // ── Retention ───────────────────────────────────────────────────
  /**
   * Delete whole effects settled at or before `before` — never single facts (D161).
   * An effect with an open send is kept however old, and so is one whose warning promises an action still ahead (D166).
   * Reads older than the window go with them, and the count stays the effects' (D193).
   */
  prune(before) {
    assertUtcInstant(before, "before");
    this.db.prepare("DELETE FROM item_snapshot WHERE read_at <= ?").run(before);
    return this.db.prepare(
      `
                DELETE FROM effect_fact
                WHERE effect_id IN (
                        SELECT effect_id FROM effect_fact
                        GROUP BY effect_id HAVING MAX(at) <= $before
                    )
                  AND effect_id NOT IN (
                        SELECT sent.effect_id FROM effect_fact sent
                        WHERE sent.kind = 'sent' AND ${STILL_OPEN}
                    )
                  AND effect_id NOT IN (${PROMISE_AHEAD})
            `
    ).run({ $before: before }).changes;
  }
  /** Delete decision rows taken at or before `before`, on the deliveries window (D163). */
  pruneDecisions(before) {
    assertUtcInstant(before, "before");
    return this.db.prepare("DELETE FROM decision WHERE at <= ?").run(before).changes;
  }
};

// src/store/schema.ts
import { isDeepStrictEqual } from "node:util";
var CURRENT_STORAGE_SCHEMA_VERSION = 1;
var SEEN_DELIVERY = `
    CREATE TABLE seen_delivery (
        delivery_id   TEXT PRIMARY KEY,
        event_name    TEXT NOT NULL,
        payload       BLOB,
        payload_digest TEXT NOT NULL,
        received_at   TEXT NOT NULL,
        state         TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'done', 'failed')),
        claim_worker  TEXT,
        claim_token   TEXT,
        claimed_at    TEXT,
        completed_at  TEXT,
        attempts      INTEGER NOT NULL CHECK (attempts >= 0),
        retry_not_before TEXT,
        CHECK (
            (state = 'pending' AND payload IS NOT NULL
                AND claim_worker IS NULL AND claim_token IS NULL
                AND claimed_at IS NULL AND completed_at IS NULL)
            OR
            (state = 'processing' AND payload IS NOT NULL
                AND claim_worker IS NOT NULL AND claim_token IS NOT NULL
                AND claimed_at IS NOT NULL AND completed_at IS NULL
                AND retry_not_before IS NULL)
            OR
            (state = 'done' AND payload IS NULL
                AND claim_worker IS NULL AND claim_token IS NULL
                AND claimed_at IS NULL AND completed_at IS NOT NULL
                AND retry_not_before IS NULL)
            OR
            (state = 'failed' AND payload IS NOT NULL
                AND claim_worker IS NULL AND claim_token IS NULL
                AND claimed_at IS NULL AND completed_at IS NOT NULL
                AND retry_not_before IS NULL AND attempts > 0)
        )
    )`;
var DELIVERY_WORK = `
    CREATE INDEX delivery_work
        ON seen_delivery(state, received_at, delivery_id)`;
var EFFECT_FACT = `
    CREATE TABLE effect_fact (
        fact_id     INTEGER PRIMARY KEY,
        effect_id   TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        kind        TEXT NOT NULL CHECK (kind IN ('sent','unsent','landed','refused','abandoned','warned','reversed')),
        at          TEXT NOT NULL,
        revision    TEXT NOT NULL,
        capability  TEXT NOT NULL,
        repository  TEXT NOT NULL,
        item_kind   TEXT NOT NULL,
        item_number INTEGER NOT NULL,
        verb        TEXT,
        login       TEXT,
        code        TEXT,
        detail      TEXT,
        payload     TEXT
    )`;
var FACT_BY_EFFECT = `
    CREATE INDEX fact_by_effect ON effect_fact(effect_id, seq, fact_id)`;
var FACT_BY_ITEM = `
    CREATE INDEX fact_by_item   ON effect_fact(repository, item_kind, item_number, kind, at)`;
var OPEN_SENDS = `
    CREATE INDEX open_sends     ON effect_fact(at) WHERE kind = 'sent'`;
var DECISION = `
    CREATE TABLE decision (
        pass_id     TEXT NOT NULL,
        source      TEXT NOT NULL CHECK (source IN ('webhook','sweep')),
        source_id   TEXT NOT NULL,
        at          TEXT NOT NULL,
        repository  TEXT NOT NULL,
        item_kind   TEXT NOT NULL,
        item_number INTEGER NOT NULL,
        capability  TEXT NOT NULL,
        verdict     TEXT NOT NULL,
        code        TEXT,
        detail      TEXT,
        effect_id   TEXT
    )`;
var DECISION_BY_ITEM = `
    CREATE INDEX decision_by_item ON decision(repository, item_kind, item_number, at)`;
var DECISION_BY_AT = `
    CREATE INDEX decision_by_at   ON decision(at)`;
var EFFECT_CLAIM = `
    CREATE TABLE effect_claim (
        effect_id TEXT PRIMARY KEY,
        worker    TEXT NOT NULL,
        at        TEXT NOT NULL
    )`;
var SCHEDULE = `
    CREATE TABLE schedule (
        schedule_id TEXT PRIMARY KEY,
        due_at      TEXT NOT NULL,
        effect      TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done')),
        claimed_at  TEXT,
        claim_token TEXT,
        resume_after INTEGER,
        started_at  TEXT
    )`;
var ITEM_SNAPSHOT = `
    CREATE TABLE item_snapshot (
        repository  TEXT NOT NULL,
        item_kind   TEXT NOT NULL,
        item_number INTEGER NOT NULL,
        updated_at  TEXT NOT NULL,
        read_at     TEXT NOT NULL,
        facts       TEXT NOT NULL,
        PRIMARY KEY (repository, item_kind, item_number)
    )`;
var SCHEMA_BY_VERSION = {
  1: {
    decision: DECISION,
    decision_by_at: DECISION_BY_AT,
    decision_by_item: DECISION_BY_ITEM,
    delivery_work: DELIVERY_WORK,
    effect_claim: EFFECT_CLAIM,
    effect_fact: EFFECT_FACT,
    fact_by_effect: FACT_BY_EFFECT,
    fact_by_item: FACT_BY_ITEM,
    item_snapshot: ITEM_SNAPSHOT,
    open_sends: OPEN_SENDS,
    schedule: SCHEDULE,
    seen_delivery: SEEN_DELIVERY
  }
};
function schemaObjects(db) {
  return db.prepare(
    `
        SELECT name, sql FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    `
  ).all();
}
function normalizeSql(sql) {
  return sql.replace(/\s+/g, "");
}
function schemaMatchesVersion(db, version) {
  const actual = Object.fromEntries(
    schemaObjects(db).map((object) => [object.name, normalizeSql(object.sql)])
  );
  const expected = Object.fromEntries(
    Object.entries(SCHEMA_BY_VERSION[version]).map(([name, sql]) => [name, normalizeSql(sql)])
  );
  return isDeepStrictEqual(actual, expected);
}
function assertSchemaMatchesVersion(db, version) {
  if (!schemaMatchesVersion(db, version)) {
    throw new Error(`storage schema does not match declared version ${String(version)}`);
  }
}
function detectUnversionedSchema(db) {
  if (schemaObjects(db).length > 0) {
    throw new Error("unrecognized unversioned storage schema");
  }
  return 0;
}
function setVersion(db, version) {
  db.exec(`PRAGMA user_version = ${String(version)}`);
}
function createSchema(db) {
  db.exec(
    `${SEEN_DELIVERY};${DELIVERY_WORK};
         ${EFFECT_FACT};${FACT_BY_EFFECT};${FACT_BY_ITEM};${OPEN_SENDS};
         ${DECISION};${DECISION_BY_ITEM};${DECISION_BY_AT};
         ${EFFECT_CLAIM};${SCHEDULE};${ITEM_SNAPSHOT};`
  );
}
var MIGRATIONS = [{ version: 1, apply: createSchema }];
function readStorageSchemaVersion(db) {
  const row2 = db.prepare("PRAGMA user_version").get();
  return row2.user_version;
}
function assertSupportedStorageSchemaVersion(version) {
  if (version > CURRENT_STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `storage schema version ${String(version)} is newer than supported version ${String(CURRENT_STORAGE_SCHEMA_VERSION)}`
    );
  }
}
function migrateStorageSchema(db, injectFault = () => {
}) {
  const declaredVersion = readStorageSchemaVersion(db);
  assertSupportedStorageSchemaVersion(declaredVersion);
  db.exec("BEGIN IMMEDIATE");
  try {
    let version = declaredVersion;
    if (version === 0) {
      version = detectUnversionedSchema(db);
    } else {
      assertSchemaMatchesVersion(db, version);
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= version) continue;
      migration.apply(db);
      setVersion(db, migration.version);
      injectFault(`migration:${String(migration.version)}`);
      version = migration.version;
    }
    assertSchemaMatchesVersion(db, CURRENT_STORAGE_SCHEMA_VERSION);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw error;
  }
}

// src/store/snapshots.ts
function encodeSnapshot(facts) {
  return JSON.stringify(facts);
}
var recordOf3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
function groupOf(value, read) {
  return value === UNREAD ? UNREAD : read(value);
}
function itemOf2(value) {
  const ref = recordOf3(value);
  const kind = ENTITY_KINDS.find((named2) => named2 === ref?.["kind"]);
  const number = ref?.["number"];
  return kind === void 0 || typeof number !== "number" || !Number.isSafeInteger(number) ? null : { kind, number };
}
function each2(value, read) {
  if (!Array.isArray(value)) return null;
  const entries = [];
  for (const entry of value) {
    const one = read(entry);
    if (one === null) return null;
    entries.push(one);
  }
  return entries;
}
var groupNameOf = (value) => FACT_GROUPS.find((group) => group === value) ?? null;
function keptOf(kind, stored) {
  const groups = {};
  for (const group of keptOn(kind)) {
    const value = decodeKept(kind, group, stored[group]);
    if (value === null) return null;
    groups[group] = value;
  }
  return groups;
}
function decodeSnapshot(stored) {
  let parsed2;
  try {
    parsed2 = JSON.parse(stored);
  } catch {
    return null;
  }
  const facts = recordOf3(parsed2);
  const groups = each2(facts?.["groups"], groupNameOf);
  if (facts === null || groups === null) return null;
  const kind = ENTITY_KINDS.find((named2) => named2 === facts["kind"]);
  if (kind === void 0) return null;
  const kept = keptOf(kind, facts);
  if (kept === null) return null;
  if (kind === "issue") return { kind, groups, ...kept };
  const closes = groupOf(facts["closes"], (value) => each2(value, itemOf2));
  return closes === null ? null : { kind, groups, ...kept, closes };
}
function snapshotAnswers(stored, needed) {
  if (stored.groups.join(",") !== needed.join(",")) return false;
  const held2 = stored;
  return keptOn(stored.kind).every((group) => !needed.includes(group) || held2[group] !== UNREAD);
}

// src/store/store.ts
import { backup, DatabaseSync } from "node:sqlite";
var Store = class {
  db;
  inbox;
  ledger;
  constructor(path, options = {}) {
    this.db = new DatabaseSync(path);
    const injectFault = options.injectFault ?? (() => {
    });
    try {
      const schemaVersion = readStorageSchemaVersion(this.db);
      assertSupportedStorageSchemaVersion(schemaVersion);
      this.db.exec(`
                PRAGMA busy_timeout = 2000;
                PRAGMA journal_mode = DELETE;
                PRAGMA synchronous = FULL;
            `);
      migrateStorageSchema(this.db, injectFault);
    } catch (error) {
      try {
        this.db.close();
      } catch {
      }
      throw error;
    }
    this.inbox = new Inbox(this.db, injectFault);
    this.ledger = new Ledger(this.db);
  }
  close() {
    this.db.close();
  }
};

// src/shell/observe/explain.ts
var planOf = (facts) => facts.reduce((longest, fact) => Math.max(longest, fact.seq), 0);
function stateLine(state, plan) {
  const of = `of \u2265${String(plan)}`;
  switch (state.kind) {
    case "neverStarted":
      return "state: neverStarted";
    case "open":
      return `state: open (seq ${String(state.seq)} ${of}, attempts ${String(state.attempts)})`;
    case "resumable":
      return `state: resumable (next seq ${String(state.nextSeq)} ${of})`;
    case "settled":
      return `state: settled ${state.how} (seq ${String(state.seq)} ${of})`;
    case "inconsistent":
      return `state: inconsistent (${state.detail})`;
  }
}
function standing2(store2, effectId) {
  const facts = store2.ledger.factsOf(effectId);
  const plan = planOf(facts);
  return stateLine(fold(facts, plan), plan).replace(/^state: /, "");
}

// src/shell/observe/summary.ts
var LOWERED = "The configuration asked for `active`; it was decided as `dry-run` because the workflow did not arm writes.";
var ABSENT = "No `sdk-automations.yml` at the default branch: nothing is enabled, so nothing was decided.";
var cell = (value) => value === null || value === "" ? "-" : String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ");
var row = (cells) => `| ${cells.map(cell).join(" | ")} |`;
var table = (head, rows) => [
  row(head),
  row(head.map(() => "---")),
  ...rows,
  ""
];
var spelled2 = (item) => `${item.kind}#${String(item.number)}`;
function distinct(items) {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => !seen.has(spelled2(item)) && seen.add(spelled2(item)));
}
function failures(events) {
  return events.filter(
    (event) => event.event === "deliveryAttemptFailed" || event.event === "deliveryDeadLettered" || event.event === "sweepFailed" || event.event === "configurationUnavailable" && event.reason === "unreadable" || event.event === "deliveryCompleted" && event.kind === "repositoryMismatch"
  );
}
function undecided(events) {
  return events.filter(
    (event) => event.event === "deliveryCompleted" && event.kind !== "decision" && event.kind !== "repositoryMismatch" || event.event === "configurationUnavailable" && event.reason === "rejected"
  );
}
var detailOf = (event) => "detail" in event && typeof event.detail === "string" ? event.detail.split("\n")[0] ?? "" : "";
var named = (event) => event.event === "deliveryCompleted" || event.event === "configurationUnavailable" ? `${event.event} (${event.event === "deliveryCompleted" ? event.kind : event.reason})` : event.event;
function itemSection(store2, repository, item) {
  const decisions = store2.ledger.decisionsOn(repository, item);
  const effects = store2.ledger.effectsOn(repository, item);
  if (decisions.length === 0 && effects.length === 0) return [];
  return [
    `### ${spelled2(item)}`,
    "",
    ...table(
      ["capability", "verdict", "code", "detail"],
      decisions.map(
        ({ capability, verdict, code, detail }) => row([capability, verdict, code, detail])
      )
    ),
    ...table(
      ["effect", "stands"],
      effects.map((effectId) => row([effectId, standing2(store2, effectId)]))
    )
  ];
}
function renderSummary(store2, run2, outcome) {
  const { owner, repo } = run2.repository;
  const link = run2.runUrl === null ? "" : ` ([run](${run2.runUrl}))`;
  const lines = [`## ${owner}/${repo}: ${run2.eventName} (${outcome.kind})${link}`, ""];
  if (outcome.modeLowered) lines.push(LOWERED, "");
  if (outcome.configAbsent) lines.push(ABSENT, "");
  const sections = distinct(outcome.items).map(
    (item) => itemSection(store2, run2.repository, item)
  );
  const silent = sections.filter((section2) => section2.length === 0).length;
  lines.push(...sections.flat());
  if (silent > 0) lines.push(`Items decided with no rows: ${String(silent)}.`, "");
  for (const event of undecided(outcome.events)) {
    const detail = detailOf(event);
    lines.push(`No decision: \`${named(event)}\`${detail === "" ? "" : `, ${detail}`}.`, "");
  }
  const [cause] = failures(outcome.events);
  if (outcome.exitCode !== 0 && cause !== void 0) {
    const detail = detailOf(cause);
    lines.push(
      `The run exited non-zero: \`${named(cause)}\`${detail === "" ? "" : `, ${detail}`}.`
    );
  }
  return `${lines.join("\n")}
`;
}
var command2 = (level, message) => `::${level}::${message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`;
var LEVEL = {
  applied: "notice",
  refused: "warning"
};
var effectLine = (effect) => `${effect.capability} ${effect.operation} ${spelled2(effect.item)} ${effect.outcome}` + (effect.code === null ? "" : ` ${effect.code}`);
function annotations(outcome) {
  const detail = (event) => detailOf(event) === "" ? "" : ` ${detailOf(event)}`;
  return [
    ...outcome.modeLowered ? [command2("notice", LOWERED)] : [],
    ...outcome.configAbsent ? [command2("warning", ABSENT)] : [],
    ...outcome.effects.flatMap((effect) => {
      const level = LEVEL[effect.outcome];
      return level === void 0 ? [] : [command2(level, effectLine(effect))];
    }),
    ...[...undecided(outcome.events), ...failures(outcome.events)].map(
      (event) => command2("warning", `${named(event)}${detail(event)}`)
    )
  ];
}
var ROW_MARKER = "sdk-automations.row";
function rowLines(store2, repository, outcome) {
  return distinct(outcome.items).flatMap(
    (item) => store2.ledger.decisionsOn(repository, item).map(({ capability, verdict, code, detail }) => {
      const row2 = { item: { kind: item.kind, number: item.number }, capability, verdict };
      return `${ROW_MARKER} ${JSON.stringify({ ...row2, code, detail })}`;
    })
  );
}
function appendSummary(path, text3) {
  if (path === void 0 || path === "") return;
  appendFileSync(path, text3);
}

// src/shell/compose/action/inputs.ts
import { createHash as createHash4 } from "node:crypto";
var ACTION_REFUSAL = {
  repository: "GITHUB_REPOSITORY must be owner/repo; the runner sets it.",
  event: "GITHUB_EVENT_NAME and GITHUB_EVENT_PATH are required; the runner sets both.",
  token: "the token input is required: pass `token: ${{ github.token }}` or leave the default.",
  arm: 'arm-writes must be "true" or "false".',
  run: "GITHUB_RUN_ID is required; the runner sets it.",
  apiUrl: "GITHUB_API_URL must be an https origin with no path (http only on loopback); the runner sets it.",
  identity: "bot-login must end in [bot] and app-id must be a whole number: the identity the token writes as, so a run recognises its own comments."
};
function deliveryIdOf(runId, attempt) {
  const hex = createHash4("sha256").update(`${runId}.${attempt}`).digest("hex");
  const guid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return asDeliveryGuid(guid);
}
function webhookEventOf(runnerEvent) {
  return runnerEvent === "pull_request_target" ? "pull_request" : runnerEvent;
}
function repositoryOf2(spelled3) {
  const halves = /^([^/\s]+)\/([^/\s]+)$/.exec(spelled3 ?? "");
  return halves === null ? null : { owner: halves[1], repo: halves[2] };
}
var RUNNER_GRANTS = [
  "contents:read",
  "issues:write",
  "metadata:read",
  "pull_requests:write"
];
var RUNNER_IDENTITY = {
  appId: "15368",
  botLogin: "github-actions[bot]",
  slug: "github-actions"
};
var LOOPBACK = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "[::1]"]);
function apiOriginOf(spelled3) {
  let url;
  try {
    url = new URL(spelled3);
  } catch {
    return null;
  }
  const bare = (url.protocol === "https:" || url.protocol === "http:" && LOOPBACK.has(url.hostname)) && url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
  return bare ? url.origin : null;
}
function parseActionEnvironment(env) {
  const errors = [];
  const repository = repositoryOf2(env["GITHUB_REPOSITORY"]);
  if (repository === null) errors.push(ACTION_REFUSAL.repository);
  const eventName = webhookEventOf(env["GITHUB_EVENT_NAME"] ?? "");
  const eventPath = env["GITHUB_EVENT_PATH"] ?? "";
  if (eventName === "" || eventPath === "") errors.push(ACTION_REFUSAL.event);
  const token = env["INPUT_TOKEN"] ?? env["GITHUB_TOKEN"] ?? "";
  if (token === "") errors.push(ACTION_REFUSAL.token);
  const arm = env["INPUT_ARM-WRITES"] ?? "false";
  if (arm !== "true" && arm !== "false") errors.push(ACTION_REFUSAL.arm);
  const runId = env["GITHUB_RUN_ID"] ?? "";
  if (runId === "") errors.push(ACTION_REFUSAL.run);
  const botLogin = env["INPUT_BOT-LOGIN"] ?? RUNNER_IDENTITY.botLogin;
  const appId = env["INPUT_APP-ID"] ?? RUNNER_IDENTITY.appId;
  if (!botLogin.endsWith("[bot]") || !/^\d+$/.test(appId)) errors.push(ACTION_REFUSAL.identity);
  const apiUrl = env["GITHUB_API_URL"];
  const apiOrigin = apiUrl === void 0 ? null : apiOriginOf(apiUrl);
  if (apiUrl !== void 0 && apiOrigin === null) errors.push(ACTION_REFUSAL.apiUrl);
  const slug = botLogin.replace(/\[bot\]$/, "");
  if (errors.length > 0 || repository === null) return { ok: false, errors };
  const server = env["GITHUB_SERVER_URL"];
  return {
    ok: true,
    run: {
      repository,
      eventName,
      eventPath,
      token,
      armWrites: arm === "true",
      apiOrigin,
      identity: { appId, botLogin, slug },
      deliveryId: deliveryIdOf(runId, env["GITHUB_RUN_ATTEMPT"] ?? "1"),
      runUrl: server === void 0 ? null : `${server}/${repository.owner}/${repository.repo}/actions/runs/${runId}`
    }
  };
}
function itemNamedBy(payload) {
  let parsed2;
  try {
    parsed2 = JSON.parse(Buffer.from(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed2 !== "object" || parsed2 === null) return null;
  const record2 = parsed2;
  const pull = record2["pull_request"];
  if (typeof pull?.["number"] === "number")
    return { kind: "pullRequest", number: pull["number"] };
  const issue = record2["issue"];
  if (typeof issue?.["number"] !== "number") return null;
  return {
    kind: issue["pull_request"] === void 0 ? "issue" : "pullRequest",
    number: issue["number"]
  };
}

// ../capabilities/src/triageQueue/messages.ts
function skillRow(skills3) {
  const [tier] = skills3;
  if (tier === void 0)
    return { done: false, text: "Skill level \u2014 the team sets one skill label" };
  if (skills3.length > 1) {
    return { done: false, text: "Skill level \u2014 more than one skill label; the team keeps one" };
  }
  return { done: true, text: `Skill level \u2014 ${tier}` };
}
function welcome(author, locked3, checklist2) {
  const opening = `\u{1F44B} Hi ${mentions([author])} \u2014 thanks for opening this issue. It is in the triage queue`;
  const message = locked3 ? `${opening}, and the conversation is locked until the team has triaged it. You do not need to do anything: the lock lifts when the issue is marked ready, and we will follow up here.` : `${opening}; the team will triage it and follow up here.`;
  if (checklist2.length === 0) return message;
  const rows = checklist2.map((row2) => `- [${row2.done ? "x" : " "}] ${row2.text}`);
  return `${message}

Triage checklist:
${rows.join("\n")}`;
}
var unlocked = (author) => `\u2705 Hi ${mentions([author])} \u2014 this issue has been triaged and marked ready. The conversation is open again.`;

// ../capabilities/src/triageQueue/settings.ts
var TRIAGE_QUEUE_SETTINGS = spec({
  welcome: flag({
    default: false,
    doc: "Post a welcome comment on a new issue, saying it is waiting for triage; a requirement below posts it too"
  }),
  lockUntilTriaged: flag({
    default: false,
    doc: `Lock a new issue's conversation until someone with triage access adds the ready label \u2014 mappings.labels.ready, default "status: ready", which no capability creates yet; the welcome is posted either way`
  }),
  confirmUnlock: flag({
    default: false,
    doc: "Post a comment when the ready label unlocks the issue; does nothing unless lockUntilTriaged is on"
  }),
  requirements: section(
    {
      skill: flag({
        default: false,
        needs: "skills",
        doc: "Exactly one mapped skill label, from mappings.skills; the repository creates those labels"
      })
    },
    {
      doc: "What a triaged issue carries, one opt-in item each, shown as a checklist in the welcome; nothing moves the issue yet"
    }
  )
});

// ../capabilities/src/triageQueue/capability.ts
var triageQueueDeclaration = declareCapability({
  name: "triageQueue",
  triggers: [{ kind: "event", event: "issues" }],
  needs: ["locked", "skills"],
  settings: TRIAGE_QUEUE_SETTINGS,
  requiredMappings: { labels: ["awaitingTriage"] },
  labels: ["awaitingTriage"],
  resolvers: ["isAutomationActor"],
  intents: ["applyMappedLabel", "postManagedComment", "lockIssue", "unlockIssue"]
});
var TRIAGED = "ready";
function checklist(facts, config) {
  const rows = [];
  if (config.settings.requirements.skill) rows.push(skillRow(facts.skills));
  return rows;
}
function welcomeIntent(facts, config, platform, rows, occasion) {
  return platform.intent({
    operation: "postManagedComment",
    desired: {
      kind: "notice",
      topic: "welcome",
      body: welcome(facts.author, config.settings.lockUntilTriaged, rows)
    },
    cause: occasion.cause,
    explain: occasion.explain
  });
}
function onOpened(facts, config, platform) {
  if (facts.position.kind === "conflict") {
    return platform.skip(
      "Skipped: the item holds more than one workflow position.",
      `conflicting: ${facts.position.positions.join(", ")}`,
      "a conflict is reported, never repaired (D35)"
    );
  }
  const { meaning } = facts.position.state;
  if (meaning !== null && meaning !== "awaitingTriage") return [];
  const { welcome: welcomed, lockUntilTriaged } = config.settings;
  const rows = checklist(facts, config);
  const intents = [];
  if (meaning === null) {
    intents.push(
      platform.intent({
        operation: "applyMappedLabel",
        desired: { meaning: "awaitingTriage" },
        cause: "issueWithoutPosition",
        explain: "Placed the new issue in triage."
      })
    );
  }
  if (welcomed || lockUntilTriaged || rows.length > 0) {
    intents.push(
      welcomeIntent(facts, config, platform, rows, {
        cause: "issueWithoutPosition",
        explain: "Welcomed the author and said the issue awaits triage."
      })
    );
  }
  if (lockUntilTriaged && !facts.locked) {
    intents.push(
      platform.intent({
        operation: "lockIssue",
        desired: { reason: "the issue is waiting for triage" },
        explain: "Locked the conversation until the issue is triaged."
      })
    );
  }
  return intents;
}
function onChecklistChanged(facts, config, platform) {
  const rows = checklist(facts, config);
  if (rows.length === 0) return [];
  if (facts.position.kind !== "position") return [];
  if (facts.position.state.meaning !== "awaitingTriage") return [];
  return [
    welcomeIntent(facts, config, platform, rows, {
      cause: "triageChecklistChanged",
      explain: "Updated the triage checklist in the welcome."
    })
  ];
}
function onTriaged(facts, config, platform) {
  if (!config.settings.lockUntilTriaged || !facts.locked) return [];
  const intents = [
    platform.intent({
      operation: "unlockIssue",
      desired: { reason: "a person marked the issue ready" },
      explain: "Unlocked the conversation: the issue was marked ready."
    })
  ];
  if (config.settings.confirmUnlock) {
    intents.push(
      platform.intent({
        operation: "postManagedComment",
        desired: { kind: "notice", topic: "unlock", body: unlocked(facts.author) },
        explain: "Said the issue is ready and its conversation open."
      })
    );
  }
  return intents;
}
function completesTriage(facts, arrival) {
  if (arrival.change === "added") return arrival.meaning === TRIAGED;
  return arrival.meaning === "awaitingTriage" && facts.position.kind === "position" && facts.position.state.meaning === TRIAGED;
}
var triageQueue = {
  declaration: triageQueueDeclaration,
  // The author opened it; the actor labelled it. Either may be a machine, and only a person's
  // issue is welcomed or released — but a checklist label may come from anyone.
  async evaluate(facts, config, platform) {
    const { arrival } = facts;
    if (arrival === null) return [];
    const machine = (login) => platform.ask("isAutomationActor", { login });
    if (arrival.kind === "opened") {
      return await machine(facts.author) ? [] : onOpened(facts, config, platform);
    }
    if (completesTriage(facts, arrival)) {
      const actor = facts.actor?.login ?? null;
      if (actor === null || await machine(actor)) return [];
      return onTriaged(facts, config, platform);
    }
    if (arrival.skill === null) return [];
    const update = onChecklistChanged(facts, config, platform);
    if (update.length === 0) return [];
    return await machine(facts.author) ? [] : update;
  }
};

// ../capabilities/src/prDashboard/checks.ts
var determined = (row2) => row2.outcome === "pass" || row2.outcome === "fail";
var VERDICT_POSITIONS = ["needsRevision", "needsReview"];
function positionFor(rows, draft, current) {
  if (rows.some((row2) => row2.outcome === "fail")) return "needsRevision";
  const reviewable = current === null || current === "needsRevision";
  if (!draft && reviewable && rows.every((row2) => row2.outcome === "pass")) return "needsReview";
  return null;
}
var MAX_LISTED = 20;
var SHORT_SHA = 7;
var commitLine = (commit) => `\`${inert(commit.sha.slice(0, SHORT_SHA))}\` ${inert(commit.summary)}`;
var issueRef = (item) => `#${String(item.number)}`;
var pass = (check, listed2 = []) => ({
  check,
  outcome: "pass",
  listed: listed2,
  guide: null
});
function fail(check, failing, guide2) {
  const rest = failing.length - MAX_LISTED;
  const listed2 = rest > 0 ? [...failing.slice(0, MAX_LISTED), `\u2026and ${String(rest)} more`] : failing;
  return { check, outcome: "fail", listed: listed2, guide: guide2 };
}
var undetermined = (check) => ({
  check,
  outcome: "undetermined",
  listed: [],
  guide: null
});
function dcoSignoff(commits, guide2) {
  const unsigned = commits.filter((commit) => !commit.merge && !commit.signedOff);
  return unsigned.length === 0 ? pass("dcoSignoff") : fail("dcoSignoff", unsigned.map(commitLine), guide2);
}
function gpgSignature(commits, guide2) {
  const unverified = commits.filter((commit) => !commit.verified);
  return unverified.length === 0 ? pass("gpgSignature") : fail("gpgSignature", unverified.map(commitLine), guide2);
}
var mergeConflicts = (mergeable) => mergeable ? pass("mergeConflicts") : fail("mergeConflicts", [], null);
var linkedIssues = (linked, guide2) => linked.length === 0 ? fail("linkedIssues", [], guide2) : pass("linkedIssues", linked.map(issueRef));
var sameLogin = (a, b) => a.toLowerCase() === b.toLowerCase();
function assignedIssues(author, assigned, guide2) {
  if (assigned.length === 0) return fail("assignedIssues", [], guide2);
  const unassigned = assigned.filter(
    (issue) => !issue.logins.some((login) => sameLogin(login, author))
  );
  return unassigned.length === 0 ? pass("assignedIssues") : fail(
    "assignedIssues",
    unassigned.map((issue) => issueRef(issue.item)),
    guide2
  );
}

// ../capabilities/src/prDashboard/settings.ts
var guide = (doc) => text({ optional: true, doc });
var COMMIT_GUIDE = "A page explaining how to sign commits, shown to the contributor when this check fails";
var PR_DASHBOARD_SETTINGS = spec({
  checks: section(
    {
      dcoSignoff: block(
        { guide: guide(COMMIT_GUIDE) },
        { doc: "Say so when a commit carries no Signed-off-by trailer" }
      ),
      gpgSignature: block(
        { guide: guide(COMMIT_GUIDE) },
        { doc: "Say so when a commit has no verified signature" }
      ),
      mergeConflicts: block({}, { doc: "Say so when the branch does not merge cleanly" }),
      linkedIssues: block(
        {
          guide: guide(
            "A page explaining how to link an issue, shown to the contributor when this check fails"
          ),
          assignedIssues: block(
            {
              guide: guide(
                "A page explaining how to get assigned, shown to the contributor when this check fails"
              )
            },
            { doc: "Say so when the author is not assigned to every linked issue" }
          )
        },
        { doc: "Say so when a pull request references no issue" }
      )
    },
    { doc: "The quality checks this repository runs \u2014 each one off until it is enabled" }
  ),
  applyLabels: meanings({
    doc: "The positions the dashboard may set: needsRevision on any failure, needsReview when every check passes on a pull request that is ready for review"
  })
});

// ../capabilities/src/prDashboard/declaration.ts
var prDashboardDeclaration = declareCapability({
  name: "prDashboard",
  triggers: [
    { kind: "event", event: "pull_request" },
    { kind: "schedule", description: "hourly recheck of every open pull request" }
  ],
  needs: ["readiness"],
  settings: PR_DASHBOARD_SETTINGS,
  labels: VERDICT_POSITIONS,
  resolvers: [
    "isAutomationActor",
    "linkedIssues",
    "commitAttestations",
    "mergeability",
    "assigneesOf"
  ],
  intents: ["postManagedComment", "applyMappedLabel"]
});

// ../capabilities/src/prDashboard/messages.ts
var TITLE = {
  dcoSignoff: "DCO sign-off",
  gpgSignature: "GPG signature",
  mergeConflicts: "Merge conflicts",
  linkedIssues: "Issue link",
  assignedIssues: "Assignment"
};
var PASSED = {
  dcoSignoff: "Every commit carries a sign-off.",
  gpgSignature: "Every commit has a verified signature.",
  mergeConflicts: "This branch merges cleanly.",
  linkedIssues: "Linked to",
  assignedIssues: "You are assigned to every linked issue."
};
var FAILED = {
  dcoSignoff: "These commits carry no `Signed-off-by` trailer:",
  gpgSignature: "These commits have no verified signature:",
  mergeConflicts: "This branch has conflicts with its base branch.",
  linkedIssues: "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.",
  assignedIssues: "You are not assigned to"
};
var UNDETERMINED = {
  dcoSignoff: "The commits could not be read this time.",
  gpgSignature: "The commits could not be read this time.",
  mergeConflicts: "GitHub has not said yet whether this branch merges cleanly.",
  linkedIssues: "The linked issues could not be read this time.",
  assignedIssues: "The linked issues' assignees could not be read this time."
};
var NOTHING_LINKED = "No issue is linked, so we cannot tell whether you are assigned to it. Link the issue this pull request closes to check assignment.";
var MARK = { pass: "\u2705", fail: "\u274C", undetermined: "\u23F3" };
var ALL_PASS = "\u2705 Every check passes.";
var SOME_FAIL = "This repository requires all of these checks to pass before review.";
var SOME_UNDETERMINED = "\u23F3 A check could not run this time. It runs again on the next update to this pull request.";
function failed(row2) {
  switch (row2.check) {
    case "dcoSignoff":
    case "gpgSignature":
      return `${FAILED[row2.check]}
${row2.listed.join("\n")}`;
    case "assignedIssues":
      return row2.listed.length === 0 ? NOTHING_LINKED : `${FAILED.assignedIssues} ${row2.listed.join(", ")}.`;
    default:
      return FAILED[row2.check];
  }
}
function sentence(row2) {
  switch (row2.outcome) {
    case "pass":
      return row2.check === "linkedIssues" ? `${PASSED.linkedIssues} ${row2.listed.join(", ")}.` : PASSED[row2.check];
    case "fail":
      return row2.guide === null ? failed(row2) : `${failed(row2)}
See the guide: ${row2.guide}`;
    case "undetermined":
      return UNDETERMINED[row2.check];
  }
}
var closing = (rows) => {
  if (rows.some((row2) => row2.outcome === "fail")) return SOME_FAIL;
  if (rows.every((row2) => row2.outcome === "pass")) return ALL_PASS;
  return SOME_UNDETERMINED;
};
function dashboard(author, rows) {
  const paragraphs = rows.map(
    (row2) => `${MARK[row2.outcome]} **${TITLE[row2.check]}** \u2014 ${sentence(row2)}`
  );
  return [`Hey ${mentions([author])} \u{1F44B} Thanks for the PR!`, ...paragraphs, closing(rows)].join(
    "\n\n"
  );
}

// ../capabilities/src/prDashboard/rows.ts
function unanswered(platform, check, answer) {
  platform.explain({
    capability: prDashboardDeclaration.name,
    summary: `The ${check} check could not run: a resolver could not answer.`,
    detail: [`resolver reason: ${answer.reason}`, answer.detail]
  });
  return undetermined(check);
}
var anyEnabled = (checks) => [checks.dcoSignoff, checks.gpgSignature, checks.mergeConflicts, checks.linkedIssues].some(
  (check) => check.enabled
);
async function commitRows(checks, item, platform) {
  const { dcoSignoff: dco, gpgSignature: gpg } = checks;
  if (!dco.enabled && !gpg.enabled) return [];
  const commits = await platform.resolve("commitAttestations", { item });
  const rows = [];
  if (dco.enabled) {
    rows.push(
      commits.ok ? dcoSignoff(commits.value, dco.guide) : unanswered(platform, "dcoSignoff", commits)
    );
  }
  if (gpg.enabled) {
    rows.push(
      commits.ok ? gpgSignature(commits.value, gpg.guide) : unanswered(platform, "gpgSignature", commits)
    );
  }
  return rows;
}
async function mergeRows(checks, item, platform) {
  if (!checks.mergeConflicts.enabled) return [];
  const mergeable = await platform.resolve("mergeability", { item });
  return [
    mergeable.ok ? mergeConflicts(mergeable.value) : unanswered(platform, "mergeConflicts", mergeable)
  ];
}
function distinctIssues(linked) {
  const byNumber = new Map(
    linked.filter((item) => item.kind === "issue").map((item) => [item.number, item])
  );
  return [...byNumber.values()];
}
async function assigneesOf(linked, platform) {
  const assigned = [];
  for (const item of linked) {
    const logins = await platform.resolve("assigneesOf", { item });
    if (!logins.ok) return logins;
    assigned.push({ item, logins: logins.value });
  }
  return { ok: true, value: assigned };
}
async function linkRows(checks, item, author, platform) {
  const check = checks.linkedIssues;
  if (!check.enabled) return [];
  const linked = await platform.resolve("linkedIssues", { item });
  const rows = [
    linked.ok ? linkedIssues(linked.value, check.guide) : unanswered(platform, "linkedIssues", linked)
  ];
  const sub = check.assignedIssues;
  if (!sub.enabled) return rows;
  if (!linked.ok) return [...rows, undetermined("assignedIssues")];
  const assigned = await assigneesOf(distinctIssues(linked.value), platform);
  return [
    ...rows,
    assigned.ok ? assignedIssues(author, assigned.value, sub.guide) : unanswered(platform, "assignedIssues", assigned)
  ];
}
async function rowsFor(checks, item, author, platform) {
  return [
    ...await commitRows(checks, item, platform),
    ...await mergeRows(checks, item, platform),
    ...await linkRows(checks, item, author, platform)
  ];
}

// ../capabilities/src/prDashboard/capability.ts
var isVerdictPosition = (name) => VERDICT_POSITIONS.includes(name);
function labelIntent(rows, facts, applyLabels, platform) {
  for (const name of applyLabels.filter((listed2) => !isVerdictPosition(listed2))) {
    platform.explain({
      capability: prDashboardDeclaration.name,
      summary: `applyLabels names ${name}, a position prDashboard never sets.`,
      detail: [`it sets ${VERDICT_POSITIONS.join(" and ")} only`]
    });
  }
  const current = facts.position.kind === "position" ? facts.position.state.meaning : null;
  const target = positionFor(rows, facts.readiness.draft, current);
  if (target === null || !applyLabels.includes(target)) return null;
  if (moveTo(facts, target) === null) {
    platform.explain({
      capability: prDashboardDeclaration.name,
      summary: `Left the position alone: no edge on the workflow map moves this pull request to ${target}.`,
      detail: []
    });
    return null;
  }
  return platform.intent({
    operation: "applyMappedLabel",
    desired: { meaning: target },
    cause: "pullRequestChecked",
    explain: `Set the position to ${target} from the checks' verdict.`
  });
}
var prDashboard = {
  declaration: prDashboardDeclaration,
  async evaluate(facts, config, platform) {
    const { checks } = config.settings;
    if (!anyEnabled(checks)) return [];
    if (await platform.ask("isAutomationActor", { login: facts.author })) return [];
    const rows = await rowsFor(checks, facts.item, facts.author, platform);
    if (!rows.some(determined)) {
      return platform.skip(
        "Skipped: no enabled check could run.",
        ...rows.map((row2) => `${row2.check}: ${row2.outcome}`)
      );
    }
    const report = platform.intent({
      operation: "postManagedComment",
      desired: { kind: "summary", body: dashboard(facts.author, rows) },
      cause: "pullRequestChecked",
      explain: {
        summary: "Reported the quality checks on this pull request.",
        detail: rows.map((row2) => `${row2.check}: ${row2.outcome}`)
      }
    });
    const label = labelIntent(rows, facts, config.settings.applyLabels, platform);
    return label === null ? [report] : [report, label];
  }
};

// ../capabilities/src/inactivity/context.ts
function ladderContext(settings, facts, platform) {
  return {
    settings,
    observedAt: facts.observedAt,
    platform
  };
}

// ../capabilities/src/inactivity/settings.ts
var remindAfter = duration({
  inherits: "remindAfter",
  doc: "Silence before this level's reminder, taken from the level above when unset"
});
var ladder = {
  remindAfter,
  reap: block(
    {
      after: duration({
        inherits: "reap.after",
        above: ["remindAfter", MIN_GRACE_HOURS],
        atLeast: MIN_REAP_HOURS,
        doc: "Silence before this level's release, taken from the level above when unset"
      })
    },
    {
      doc: "Release what this level reminded about \u2014 absent or off means remind and never act"
    }
  )
};
var INACTIVITY_SETTINGS = spec({
  exemptBlocked: flag({
    default: true,
    doc: "Leave anything carrying the blocked meaning alone \u2014 no reminder, no release"
  }),
  remindAfter: duration({
    default: "14d",
    doc: "Silence before a reminder, for every ladder and reason that sets none of its own"
  }),
  reap: section(
    {
      after: duration({
        default: "21d",
        doc: "Silence before release \u2014 an issue is unassigned, a pull request closed"
      })
    },
    {
      doc: "The release clock every ladder and reason inherits \u2014 consent is each acting level's own"
    }
  ),
  issues: block(
    { ...ladder },
    { doc: "Run the ladder on assigned issues that have no open pull request" }
  ),
  pullRequests: block(
    {
      remindAfter,
      reap: section(
        {
          after: duration({
            inherits: "reap.after",
            doc: "The release clock this ladder's reasons inherit, taken from the capability default when unset"
          })
        },
        {
          doc: "The release clock every reason below inherits \u2014 consent is each reason's own"
        }
      ),
      reapWhen: section(
        {
          draft: block(
            { ...ladder },
            { doc: "Pull requests GitHub is holding as drafts \u2014 no mapping needed" }
          ),
          changesRequested: block(
            { ...ladder },
            {
              doc: "Pull requests a reviewer has asked for changes on \u2014 no mapping needed"
            }
          ),
          needsRevision: block(
            { ...ladder },
            {
              doc: "Pull requests carrying your needsRevision label, where a quality failure moves fast"
            }
          )
        },
        {
          doc: "The pull-request states the ladder applies in \u2014 one outside them is left alone"
        }
      )
    },
    { doc: "Run the ladder on pull requests, linked to an issue or not" }
  )
});

// ../capabilities/src/inactivity/declaration.ts
var inactivityDeclaration = declareCapability({
  name: "inactivity",
  triggers: [{ kind: "schedule", description: "hourly stale-assignment sweep" }],
  settings: INACTIVITY_SETTINGS,
  facts: ["issue", "pullRequest"],
  /** Each ladder's own groups: the issue ladder reads links, the pull-request ladder never does. */
  needs: {
    issue: ["assignees", "links"],
    pullRequest: ["assignees", "review", "readiness"]
  },
  resolvers: ["isAutomationActor"],
  intents: ["postManagedComment", "releaseAssignment", "closePullRequest"]
});

// ../capabilities/src/inactivity/ladder.ts
var REAP_REASONS = ["needsRevision", "changesRequested", "draft"];
function ladderOf(level) {
  return {
    remindAfter: level.remindAfter,
    reapAfter: level.reap.enabled ? level.reap.after : null
  };
}
function reaps(ladder2) {
  return ladder2.reapAfter !== null;
}
function graceHoursOf(ladder2) {
  return ladder2.reapAfter - ladder2.remindAfter;
}
function deadlineOf(ladder2, observedAt) {
  return new Date(observedAt.getTime() + graceHoursOf(ladder2) * HOUR_MS2);
}
function stillOnTheLadder(facts, settings) {
  if (settings.exemptBlocked && isPaused(facts)) return false;
  return !isConflicted(facts);
}

// ../capabilities/src/inactivity/messages.ts
var REASON_PHRASE = {
  needsRevision: "carried the `needsRevision` label",
  changesRequested: "had **changes requested**",
  draft: "been in **draft**"
};
function consequence(act, ladder2, observedAt) {
  if (!reaps(ladder2)) return "";
  return `, otherwise ${act} on ${on(deadlineOf(ladder2, observedAt), graceHoursOf(ladder2))}`;
}
function issueReminder(logins, ladder2, observedAt) {
  const next = consequence("this assignment will be released", ladder2, observedAt);
  return `\u23F0 Hi ${mentions(logins)} \u2014 you are assigned to this issue, but there is no pull request after ${lasting(ladder2.remindAfter)}. Still working on it? Comment \`/working\` to let us know development is active${next}.`;
}
function pullRequestReminder(logins, reason, ladder2, observedAt) {
  const opening = logins.length === 0 ? "\u23F0 This pull request has" : `\u23F0 Hi ${mentions(logins)} \u2014 this pull request has`;
  const next = consequence("the pull request will be closed", ladder2, observedAt);
  return `${opening} ${REASON_PHRASE[reason]} without development activity for ${lasting(ladder2.remindAfter)}. Push a commit or comment \`/working\` to let us know you are working on it${next}.`;
}
function closeReason(reapAfter) {
  return `This pull request was closed after ${lasting(reapAfter)} of inactivity.`;
}
function issueReleaseNotice(reapAfter) {
  return `This assignment was released after ${lasting(reapAfter)} of inactivity. The issue is open for anyone to pick up \u2014 you are welcome to \`/assign\` it again when you have capacity.`;
}

// ../capabilities/src/inactivity/issues.ts
async function onIssue(facts, context) {
  const { issues } = context.settings;
  if (!stillOnTheLadder(facts, context.settings)) return [];
  if (!issues.enabled) return [];
  if (facts.links.openPullRequests.length > 0) return [];
  return await onIssueLadder(facts, ladderOf(issues), context);
}
async function onIssueLadder(facts, ladder2, context) {
  const intents = [];
  for (const assignee of await people(context.platform, facts.assignees)) {
    const clock = assigneeClock(assignee, context.observedAt);
    if (clock.idleHours < ladder2.remindAfter) continue;
    intents.push(
      reaps(ladder2) ? release(context, assignee, clock, ladder2) : remind(context, assignee, clock, ladder2)
    );
  }
  return intents;
}
function release({ platform, observedAt }, assignee, clock, ladder2) {
  return platform.intent({
    operation: "releaseAssignment",
    desired: { login: assignee.login },
    cause: "assignmentWentStale",
    // Dated at the clock's start, not the sweep: the occasion is the idle run.
    occasion: clock.idleSince,
    explain: {
      summary: `Warned ${assignee.login} about a stale assignment; the release follows the grace.`,
      detail: [
        `idle ${lasting(clock.idleHours)}`,
        `releases after ${lasting(ladder2.reapAfter)}`
      ]
    },
    grace: {
      hours: graceHoursOf(ladder2),
      // Two stale assignees are two warnings on one issue (D145).
      topic: assignee.login,
      warning: { body: issueReminder([assignee.login], ladder2, observedAt) },
      notice: { body: issueReleaseNotice(ladder2.reapAfter) },
      cancelledBy: CANCELLED_BY,
      reversesWith: REVERSES_WITH,
      // Their own `/working`, and no one else's.
      activityAt: assignee.lastWorkingAt
    }
  });
}
function remind({ platform, observedAt }, assignee, clock, ladder2) {
  return platform.intent({
    operation: "postManagedComment",
    desired: {
      kind: "warning",
      topic: assignee.login,
      body: issueReminder([assignee.login], ladder2, observedAt)
    },
    cause: "assignmentWentStale",
    occasion: clock.idleSince,
    explain: {
      summary: `Reminded ${assignee.login} about a stale assignment; this ladder releases nothing.`,
      detail: [`idle ${lasting(clock.idleHours)}`]
    }
  });
}

// ../capabilities/src/inactivity/pull-requests.ts
function claimsFor(reason) {
  return reason === "needsRevision" ? {} : { pullRequestMode: reason };
}
function reapableFor(facts, pullRequests) {
  const holds = {
    needsRevision: meaningsOf(facts).includes("needsRevision"),
    changesRequested: facts.review.changesRequested,
    draft: facts.readiness.draft
  };
  for (const reason of REAP_REASONS) {
    const opted = pullRequests.reapWhen[reason];
    if (opted.enabled && holds[reason]) return { reason, ...ladderOf(opted) };
  }
  return null;
}
async function onPullRequest(facts, context) {
  const { pullRequests } = context.settings;
  if (!stillOnTheLadder(facts, context.settings)) return [];
  if (!pullRequests.enabled) return [];
  if (meaningsOf(facts).includes("needsReview")) return [];
  const reapable = reapableFor(facts, pullRequests);
  if (reapable === null) return [];
  return await onPullRequestLadder(facts, reapable, context);
}
async function onPullRequestLadder(facts, reapable, context) {
  const clock = pullRequestClock(facts, reapable.reason, context.observedAt);
  if (clock.idleHours < reapable.remindAfter) return [];
  const logins = (await people(context.platform, facts.assignees)).map(
    (assignee) => assignee.login
  );
  return [
    reaps(reapable) ? close(context, facts, logins, clock, reapable) : remind2(context, logins, clock, reapable)
  ];
}
function close({ platform, observedAt }, facts, logins, clock, reapable) {
  return platform.intent({
    operation: "closePullRequest",
    desired: { reason: closeReason(reapable.reapAfter) },
    cause: "pullRequestWentStale",
    // Dated at the clock's start, not the sweep: the occasion is the idle run.
    occasion: clock.idleSince,
    claims: claimsFor(reapable.reason),
    explain: {
      summary: `Warned about a pull request stale in ${reapable.reason}; the close follows the grace.`,
      detail: [
        `idle ${lasting(clock.idleHours)}`,
        `closes after ${lasting(reapable.reapAfter)}`
      ]
    },
    grace: {
      hours: graceHoursOf(reapable),
      // The reason is what the warning is about, so it is the topic (D145).
      topic: reapable.reason,
      warning: { body: pullRequestReminder(logins, reapable.reason, reapable, observedAt) },
      notice: { body: closeReason(reapable.reapAfter) },
      cancelledBy: CANCELLED_BY,
      reversesWith: REVERSES_WITH,
      // The set `pullRequestClock` resets from.
      activityAt: latestOf([
        facts.review.lastCommitAt,
        ...facts.assignees.map((assignee) => assignee.lastWorkingAt)
      ])
    }
  });
}
function remind2({ platform, observedAt }, logins, clock, reapable) {
  return platform.intent({
    operation: "postManagedComment",
    desired: {
      kind: "warning",
      topic: reapable.reason,
      body: pullRequestReminder(logins, reapable.reason, reapable, observedAt)
    },
    cause: "pullRequestWentStale",
    occasion: clock.idleSince,
    claims: claimsFor(reapable.reason),
    explain: {
      summary: `Reminded about a pull request stale in ${reapable.reason}; this reason closes nothing.`,
      detail: [`idle ${lasting(clock.idleHours)}`]
    }
  });
}

// ../capabilities/src/inactivity/capability.ts
function unmappedDemand(settings, view) {
  const { pullRequests } = settings;
  const demandsNeedsRevision = pullRequests.enabled && pullRequests.reapWhen.needsRevision.enabled;
  if (!demandsNeedsRevision || view.mapped.labels.includes("needsRevision")) return null;
  return "capabilities.inactivity.pullRequests.reapWhen.needsRevision.enabled: reaping on needsRevision needs that meaning mapped, and this repository has not mapped it";
}
var inactivity = {
  declaration: inactivityDeclaration,
  async evaluate(facts, view, platform) {
    const demanded = unmappedDemand(view.settings, view);
    if (demanded !== null) return platform.skip(`Skipped: settings unusable \u2014 ${demanded}`);
    const context = ladderContext(view.settings, facts, platform);
    return facts.kind === "issue" ? await onIssue(facts, context) : await onPullRequest(facts, context);
  }
};

// ../capabilities/src/configReport/render.ts
var indent = (depth) => "  ".repeat(depth);
var bullet = (depth, text3) => `${indent(depth)}- ${text3}`;
var TITLE2 = "### `sdk-automations.yml` \u2014 what this pull request would mean";
var FOOTER = "Read on the default branch, this changes nothing until it merges.";
var MAX_COMMENT_CHARS = 12e3;
var MAX_REPORTED_ERRORS = 100;
var SHORTENED = "_Report shortened to fit in a GitHub comment._";
var join = (lines) => lines.join("\n");
function fitComment(body) {
  if (body.length <= MAX_COMMENT_CHARS) return body;
  const ending = `

${SHORTENED}

${FOOTER}`;
  let end = MAX_COMMENT_CHARS - ending.length;
  if (body.charCodeAt(end - 1) >= 55296 && body.charCodeAt(end - 1) <= 56319) end -= 1;
  while (body[end - 1] === "\\") end -= 1;
  return `${body.slice(0, end)}${ending}`;
}
function scalar(value) {
  if (value === null) return "unset";
  if (typeof value === "string") return inert(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return inert(String(value));
}
function isGroup(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function tree(group, depth) {
  return Object.entries(group).flatMap(([key, value]) => {
    const name = inert(key);
    if (isGroup(value)) return [bullet(depth, name), ...tree(value, depth + 1)];
    if (Array.isArray(value)) {
      const entries = value.map(scalar);
      return [
        bullet(depth, `${name}: ${entries.length === 0 ? "none" : entries.join(", ")}`)
      ];
    }
    return [bullet(depth, `${name}: ${scalar(value)}`)];
  });
}
function labelsSetBy(config, meanings2) {
  if (meanings2.length === 0) return [];
  return [
    bullet(1, "labels it may set"),
    ...meanings2.map((meaning) => {
      const spelling = config.mappings.labels[meaning] ?? LABEL_DEFAULTS[meaning].name;
      return bullet(
        2,
        `${inert(spelling)} \u2014 ${meaning}; defined #${LABEL_DEFAULTS[meaning].color} if the repository lacks it`
      );
    })
  ];
}
function capabilities(config) {
  const entries = Object.entries(config.capabilities);
  const on2 = entries.filter(([, block2]) => block2.enabled);
  const off = entries.filter(([, block2]) => !block2.enabled).map(([name]) => inert(name));
  const lines = on2.flatMap(([name, block2]) => {
    const settings = tree(block2.settings, 1);
    const labels = labelsSetBy(config, block2.labels ?? []);
    return settings.length === 0 && labels.length === 0 ? [bullet(0, `${inert(name)} \u2014 on, no settings`)] : [bullet(0, `${inert(name)} \u2014 on`), ...settings, ...labels];
  });
  return [
    "**Capabilities**",
    "",
    ...lines.length === 0 ? [bullet(0, "none \u2014 this file enables no capability")] : lines,
    ...off.length === 0 ? [] : ["", `Switched off: ${off.join(", ")}.`]
  ];
}
function mappings(config) {
  const families = Object.entries(config.mappings).filter(
    ([, family]) => Object.keys(family).length > 0
  );
  if (families.length === 0) return ["**Mappings** \u2014 none."];
  return [
    "**Mappings**",
    "",
    ...families.flatMap(([family, spellings]) => [
      bullet(0, family),
      ...Object.entries(spellings).map(
        ([meaning, spelling]) => bullet(1, `${inert(meaning)}: ${inert(spelling)}`)
      )
    ])
  ];
}
function principals(config) {
  const declared = Object.entries(config.principals);
  if (declared.length === 0) return [];
  return [
    "",
    "**Principals**",
    "",
    ...declared.map(([name, handle]) => bullet(0, `${inert(name)}: ${inert(handle)}`))
  ];
}
function renderConfiguration(revision, config) {
  return fitComment(
    join([
      TITLE2,
      "",
      `The file at \`${revision}\` parses. This is what the App would read from it.`,
      "",
      `**Mode** \u2014 ${config.mode}`,
      "",
      ...capabilities(config),
      "",
      ...mappings(config),
      ...principals(config),
      "",
      FOOTER
    ])
  );
}
var lastSegment = (path) => path.slice(path.lastIndexOf(".") + 1);
var enclosing = (path) => path.slice(0, path.lastIndexOf(".") + 1);
function inherits(inner2, outer) {
  if (inner2.path === null || outer.path === null || inner2.path === outer.path) return false;
  return lastSegment(inner2.path) === lastSegment(outer.path) && enclosing(inner2.path).startsWith(enclosing(outer.path)) && enclosing(inner2.path).length > enclosing(outer.path).length;
}
function documentOrder(errors) {
  const rank = (error) => error.path === null ? 0 : error.line === void 0 ? 2 : 1;
  return [...errors].sort((a, b) => rank(a) - rank(b) || (a.line ?? 0) - (b.line ?? 0));
}
function sentence2(error) {
  const message = error.message;
  const prefix = error.path === null ? null : `${error.path}: `;
  return inert(
    prefix !== null && message.startsWith(prefix) ? message.slice(prefix.length) : message
  );
}
function line(error) {
  const where = error.line === void 0 ? "" : `line ${String(error.line)} \u2014 `;
  const path = error.path === null ? "" : `${inert(error.path)}: `;
  return bullet(0, `${where}${path}${sentence2(error)}`);
}
function causeOf(error, causes) {
  return causes.find((cause) => inherits(error, cause)) ?? null;
}
function renderRejection(revision, errors) {
  const omitted = Math.max(0, errors.length - MAX_REPORTED_ERRORS);
  const ordered = documentOrder(errors.slice(0, MAX_REPORTED_ERRORS));
  const causes = ordered.filter((error) => !ordered.some((other) => inherits(error, other)));
  const lines = causes.flatMap((cause) => {
    const followers = ordered.filter((error) => causeOf(error, causes) === cause);
    return followers.length === 0 ? [line(cause)] : [line(cause), bullet(1, `and ${String(followers.length)} places that inherit it`)];
  });
  return fitComment(
    join([
      TITLE2,
      "",
      `The file at \`${revision}\` is rejected, so the App would read no configuration from it at all \u2014 one error anywhere rejects the whole document.`,
      "",
      ...omitted === 0 ? [] : [bullet(0, `${String(omitted)} more errors not shown`), ""],
      ...lines,
      "",
      FOOTER
    ])
  );
}
function renderReport(revision, result) {
  return result.ok ? renderConfiguration(revision, result.config) : renderRejection(revision, result.errors);
}

// ../capabilities/src/configReport/settings.ts
var CONFIG_REPORT_SETTINGS = spec({});

// ../capabilities/src/configReport/capability.ts
var configReportDeclaration = declareCapability({
  name: "configReport",
  triggers: [{ kind: "event", event: "pull_request" }],
  settings: CONFIG_REPORT_SETTINGS,
  resolvers: ["configAtHead"],
  intents: ["postManagedComment"]
});
var configReport = {
  declaration: configReportDeclaration,
  async evaluate(facts, _config, platform) {
    const proposed = await platform.ask("configAtHead", { item: facts.item });
    if (!proposed.touched) return [];
    return [
      platform.intent({
        operation: "postManagedComment",
        desired: {
          kind: "summary",
          body: renderReport(proposed.revision, proposed.result)
        },
        cause: "pullRequestChangesConfiguration",
        explain: {
          summary: "Reported what this pull request's sdk-automations.yml would mean.",
          detail: [`proposed configuration read at revision ${proposed.revision}`]
        }
      })
    ];
  }
};

// ../capabilities/src/assignment/messages.ts
function listed(meanings2, conjunction) {
  const named2 = meanings2.map((meaning) => `\`${meaning}\``);
  const rest = named2.slice(0, -1);
  const last = named2.slice(-1).join("");
  return rest.length === 0 ? last : `${rest.join(", ")} ${conjunction} ${last}`;
}
var stepAway = (canRelease) => canRelease ? " If you need to step away, comment this repository's unassign command." : "";
function claimed(login, canRelease) {
  return `\u2705 Hi ${mentions([login])} \u2014 you are assigned to this issue. Thank you for picking it up!${stepAway(canRelease)}`;
}
function alreadyClaimed(login, holders) {
  const named2 = holders.map((holder) => inert(`@${holder}`)).join(", ");
  return `Hi ${mentions([login])} \u2014 this issue is already assigned to ${named2}, so it cannot be claimed.`;
}
function deniedBy(login, carried) {
  return `Hi ${mentions([login])} \u2014 this issue cannot be claimed while it is marked ${listed(carried, "and")}.`;
}
function notYetClaimable(login, required) {
  return `Hi ${mentions([login])} \u2014 only an issue marked ${listed(required, "or")} can be claimed in this repository, and this one is not yet.`;
}
function atCap(login, held2, limit, canRelease) {
  const assignments = held2 === 1 ? "1 open assignment" : `${String(held2)} open assignments`;
  const release2 = canRelease ? " Release one with this repository's unassign command, and you can claim this issue." : "";
  return `Hi ${mentions([login])} \u2014 you already have ${assignments}, and this repository's limit is ${String(limit)}.${release2}`;
}
function released(login, othersRemain) {
  const next = othersRemain ? "" : " The issue is open for anyone to pick up.";
  return `${mentions([login])} claimed this issue and has since been unassigned at their request.${next}`;
}

// ../capabilities/src/assignment/settings.ts
var ASSIGNMENT_SETTINGS = spec({
  autoAssign: block(
    {
      claimableOnlyWhen: meanings({
        doc: "An issue is claimable only while it carries one of these meanings; empty means any open issue"
      }),
      notClaimableWhen: meanings({
        doc: "An issue carrying any of these meanings is not claimable, whatever claimableOnlyWhen says"
      }),
      capIgnores: meanings({
        doc: "An open assignment carrying any of these meanings does not count toward maxOpen"
      }),
      maxOpen: count({
        default: 2,
        doc: "How many open assignments in this repository a person may hold before a claim is refused; 0 means uncapped"
      })
    },
    {
      doc: "Assign a commenter who uses this repository's assign command \u2014 needs mappings.commands.assign"
    }
  ),
  unassign: block(
    {},
    {
      doc: "Release the commenter's own assignment when they use this repository's unassign command \u2014 needs mappings.commands.unassign"
    }
  )
});

// ../capabilities/src/assignment/capability.ts
var assignmentDeclaration = declareCapability({
  name: "assignment",
  triggers: [{ kind: "event", event: "issue_comment" }],
  needs: ["command"],
  settings: ASSIGNMENT_SETTINGS,
  resolvers: ["isAutomationActor", "assigneesOf", "openAssignments"],
  intents: ["postManagedComment", "assign", "unassign"]
});
var COMMAND_OF = { autoAssign: "assign", unassign: "unassign" };
function unmappedCommands(view) {
  return Object.keys(COMMAND_OF).filter((block2) => view.settings[block2].enabled).filter((block2) => !view.mapped.commands.includes(COMMAND_OF[block2])).map((block2) => {
    const command4 = COMMAND_OF[block2];
    return `capabilities.assignment.${block2}.enabled: the ${command4} command needs mappings.commands.${command4}, and this repository has not mapped it`;
  });
}
var CLAIM = "claimRequested";
var RELEASE = "releaseRequested";
var sameLogin2 = (a, b) => a.toLowerCase() === b.toLowerCase();
function refusal(platform, { login, body, explain }) {
  return platform.intent({
    operation: "postManagedComment",
    desired: { kind: "notice", topic: login, body },
    cause: CLAIM,
    explain
  });
}
async function onAssign(facts, view, platform, login) {
  const { autoAssign, unassign: unassign3 } = view.settings;
  if (!autoAssign.enabled) return [];
  const canRelease = unassign3.enabled;
  if (await platform.ask("isAutomationActor", { login })) return [];
  const holders = await platform.ask("assigneesOf", { item: facts.item });
  if (holders.some((holder) => sameLogin2(holder, login))) {
    return platform.skip(
      "Skipped: the commenter already holds this issue.",
      `commenter: ${login}`
    );
  }
  if (holders.length > 0) {
    return [
      refusal(platform, {
        login,
        body: alreadyClaimed(login, holders),
        explain: "Told the commenter the issue is already claimed."
      })
    ];
  }
  const carried = meaningsOf(facts);
  const denied = autoAssign.notClaimableWhen.filter((meaning) => carried.includes(meaning));
  if (denied.length > 0) {
    return [
      refusal(platform, {
        login,
        body: deniedBy(login, denied),
        explain: "Told the commenter why the issue cannot be claimed."
      })
    ];
  }
  const required = autoAssign.claimableOnlyWhen;
  if (required.length > 0 && !required.some((meaning) => carried.includes(meaning))) {
    return [
      refusal(platform, {
        login,
        body: notYetClaimable(login, required),
        explain: "Told the commenter the issue is not claimable yet."
      })
    ];
  }
  if (autoAssign.maxOpen > 0) {
    const open = await platform.ask("openAssignments", { login });
    const held2 = open.filter(
      ({ meanings: meanings2 }) => !meanings2.some((meaning) => autoAssign.capIgnores.includes(meaning))
    ).length;
    if (held2 >= autoAssign.maxOpen) {
      return [
        refusal(platform, {
          login,
          body: atCap(login, held2, autoAssign.maxOpen, canRelease),
          explain: "Told the commenter they are at this repository's cap."
        })
      ];
    }
  }
  return [
    platform.intent({
      operation: "assign",
      desired: { login, notice: { topic: login, body: claimed(login, canRelease) } },
      cause: CLAIM,
      claims: { meaningsAbsent: autoAssign.notClaimableWhen },
      explain: "Assigned the commenter, who claimed the issue, and confirmed it to them."
    })
  ];
}
async function onUnassign(facts, view, platform, login) {
  if (!view.settings.unassign.enabled) return [];
  if (await platform.ask("isAutomationActor", { login })) return [];
  const holders = await platform.ask("assigneesOf", { item: facts.item });
  if (!holders.some((holder) => sameLogin2(holder, login))) {
    return platform.skip(
      "Skipped: the commenter is not assigned to this issue, so nothing of theirs was released.",
      `commenter: ${login}`
    );
  }
  const othersRemain = holders.some((holder) => !sameLogin2(holder, login));
  return [
    platform.intent({
      operation: "unassign",
      desired: { login, notice: { topic: login, body: released(login, othersRemain) } },
      cause: RELEASE,
      explain: "Unassigned the commenter at their request, and confirmed it to them."
    })
  ];
}
var assignment = {
  declaration: assignmentDeclaration,
  async evaluate(facts, view, platform) {
    const unmapped = unmappedCommands(view);
    if (unmapped.length > 0) return platform.skip("Skipped: settings unusable.", ...unmapped);
    const { issued, by } = facts.command;
    if (issued === "assign") return onAssign(facts, view, platform, by);
    if (issued === "unassign") return onUnassign(facts, view, platform, by);
    return [];
  }
};

// ../capabilities/src/index.ts
var CAPABILITIES = [
  toEngine(triageQueue),
  toEngine(prDashboard),
  toEngine(inactivity),
  toEngine(configReport),
  toEngine(assignment)
];

// src/shell/apply/actions.ts
var settledDetail = (how) => `this effect settled as ${how}; nothing more is sent`;
var landed = (pass2) => pass2.changed ? { outcome: "applied", code: null, detail: null } : {
  outcome: "already",
  code: null,
  detail: pass2.sent ? "every call in this plan already held" : "the ledger says every call in this effect's plan landed"
};
function actionFor(state, pass2) {
  switch (state.kind) {
    case "neverStarted":
      return { kind: "fresh", seq: 1 };
    case "resumable":
      return pass2.gated ? { kind: "send", seq: state.nextSeq } : { kind: "resume", seq: state.nextSeq };
    case "open":
      return { kind: "resolve", seq: state.seq, payload: state.payload };
    case "settled":
      return {
        kind: "stop",
        result: state.how === "landed" ? landed(pass2) : { outcome: "already", code: null, detail: settledDetail(state.how) }
      };
    case "inconsistent":
      return {
        kind: "stop",
        result: { outcome: "refused", code: "ledgerInconsistent", detail: state.detail }
      };
  }
}

// src/shell/effects.ts
function renderManagedBody(marker, body) {
  return `${marker}

${body}`;
}

// src/shell/apply/operations/handler.ts
var held = (seen, holds) => seen === "unknown" ? "unknown" : seen === holds ? "held" : "notHeld";
function planWithNotice(effect, act, notice) {
  if (notice === null) return { ok: true, calls: [act] };
  if (effect.managedComment === null) {
    return {
      ok: false,
      code: "identityMissing",
      detail: "the approved act carries no managed-comment identity to post its outcome notice under"
    };
  }
  return {
    ok: true,
    calls: [
      act,
      {
        verb: "postComment",
        kind: "notice",
        body: renderManagedBody(effect.managedComment.marker, notice)
      }
    ]
  };
}

// src/shell/apply/operations/row.ts
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var at = (value, name) => isRecord3(value) && Object.hasOwn(value, name) ? value[name] : void 0;
var text2 = (value, name) => {
  const read = at(value, name);
  return typeof read === "string" && read.length > 0 ? read : null;
};
function itemOf3(value) {
  const kind = at(value, "kind");
  const number = at(value, "number");
  if (kind !== "issue" && kind !== "pullRequest") return null;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return null;
  return { kind, number };
}

// src/shell/apply/operations/applyMappedLabel.ts
function defineLabel(label, meaning) {
  const { color, description } = LABEL_DEFAULTS[meaning];
  return { verb: "defineLabel", label, color, description };
}
function positionsOf(kind) {
  return kind === "issue" ? ISSUE_MEANINGS : PR_MEANINGS;
}
function displacedBy(intent) {
  return positionsOf(intent.item.kind).find(
    (meaning) => meaning !== intent.desired.meaning && intent.claims.meaningsPresent.includes(meaning)
  );
}
var applyMappedLabel2 = {
  verbs: ["defineLabel", "addLabel", "removeLabel"],
  traits: { recordsWarning: false, activityRead: false },
  /**
   * Define, add, then remove. The intermediate state carries two position labels, which projects
   * as a conflict, so every other decision safe-holds; removing first would leave a window with NO position, which reads as untriaged.
   */
  plan(effect, config) {
    const { intent } = effect;
    const target = config.mappings.labels[intent.desired.meaning];
    if (target === void 0) {
      return {
        ok: false,
        code: "labelUnmapped",
        detail: `the repository maps no label to ${intent.desired.meaning}`
      };
    }
    const define = defineLabel(target, intent.desired.meaning);
    const displaced = displacedBy(intent);
    if (displaced === void 0) {
      return { ok: true, calls: [define, { verb: "addLabel", label: target }] };
    }
    const previous = config.mappings.labels[displaced];
    if (previous === void 0) {
      return {
        ok: false,
        code: "labelUnmapped",
        detail: `the repository maps no label to the displaced position ${displaced}`
      };
    }
    return {
      ok: true,
      calls: [
        define,
        { verb: "addLabel", label: target },
        { verb: "removeLabel", label: previous }
      ]
    };
  },
  serialize: (call) => call.verb === "defineLabel" ? {
    verb: call.verb,
    label: call.label,
    color: call.color,
    description: call.description
  } : { verb: call.verb, label: call.label },
  parse(row2) {
    const verb = at(row2, "verb");
    const label = text2(row2, "label");
    if (label === null) return null;
    if (verb === "addLabel" || verb === "removeLabel") return { verb, label };
    if (verb !== "defineLabel") return null;
    const color = text2(row2, "color");
    const description = text2(row2, "description");
    return color === null || description === null ? null : { verb, label, color, description };
  },
  /** The define reads before it writes: a label the repository holds is left exactly as it is. */
  async send(call, pass2) {
    switch (call.verb) {
      case "defineLabel": {
        const defined = await pass2.reader.labelDefined(call.label);
        if (defined === "present") return { outcome: "already" };
        if (defined === "unknown") {
          return {
            outcome: "unknown",
            detail: "the read-back could not establish whether the repository defines this label"
          };
        }
        const created = await pass2.writer.createLabel(
          call.label,
          call.color,
          call.description,
          pass2.allowance
        );
        if (created.outcome !== "conflict") return created;
        const raced = await pass2.reader.labelDefined(call.label);
        if (raced === "present") return { outcome: "already" };
        if (raced === "unknown") {
          return {
            outcome: "unknown",
            detail: "the read-back could not establish whether another writer defined this label"
          };
        }
        return created;
      }
      case "addLabel":
        return await pass2.writer.addLabel(pass2.item, call.label, pass2.allowance);
      case "removeLabel":
        return await pass2.writer.removeLabel(pass2.item, call.label, pass2.allowance);
    }
  },
  async confirm(call, pass2) {
    switch (call.verb) {
      case "defineLabel":
        return held(await pass2.reader.labelDefined(call.label), "present");
      case "addLabel":
        return held(await pass2.reader.labelPresence(pass2.item, call.label), "present");
      case "removeLabel":
        return held(await pass2.reader.labelPresence(pass2.item, call.label), "absent");
    }
  }
};

// src/shell/apply/operations/assign.ts
var assign2 = {
  verbs: ["assign"],
  traits: { recordsWarning: false, activityRead: false },
  /** The act, then the notice it carries — so the notice never announces an assignment GitHub declined. */
  plan: (effect) => planWithNotice(
    effect,
    { verb: "assign", login: effect.intent.desired.login },
    effect.intent.desired.notice?.body ?? null
  ),
  serialize: (call) => ({ verb: call.verb, login: call.login }),
  parse(row2) {
    const login = text2(row2, "login");
    return login === null ? null : { verb: "assign", login };
  },
  send: async (call, pass2) => await pass2.writer.assign(pass2.item, call.login, pass2.allowance),
  /**
   * This login, on the list the item carries. The read is the only proof: GitHub answers 201
   * for a login it silently declined to assign (6.16).
   */
  async confirm(call, pass2) {
    const seen = await pass2.reader.assignees(pass2.item);
    if (!seen.ok) return "unknown";
    return seen.value.includes(call.login) ? "held" : "notHeld";
  }
};

// src/shell/apply/operations/closePullRequest.ts
var closePullRequest2 = {
  verbs: ["closePullRequest"],
  traits: { recordsWarning: false, activityRead: true },
  /** The reason travels on the call, because the row is what a resend reads. */
  plan: (effect) => planWithNotice(
    effect,
    { verb: "closePullRequest", reason: effect.intent.desired.reason },
    effect.intent.grace?.notice.body ?? null
  ),
  serialize: (call) => ({ verb: call.verb, reason: call.reason }),
  parse(row2) {
    const reason = text2(row2, "reason");
    return reason === null ? null : { verb: "closePullRequest", reason };
  },
  /** The reason is not sent: GitHub is told the state, and the notice says why (6.10). */
  send: async (_call, pass2) => await pass2.writer.closePullRequest(pass2.item, pass2.allowance),
  /**
   * The state on the pull request, and only that.
   * `closed_by` is absent from the pull object — the actor of a close is on the timeline (6.10) — so a read-back that wanted it would never confirm.
   */
  async confirm(_call, pass2) {
    const seen = await pass2.reader.item(pass2.item);
    if (!seen.ok) return "unknown";
    return seen.value.closed ? "held" : "notHeld";
  }
};

// src/shell/apply/operations/lockIssue.ts
var lockIssue2 = {
  verbs: ["lockIssue"],
  traits: { recordsWarning: false, activityRead: false },
  plan: () => ({
    ok: true,
    calls: [{ verb: "lockIssue" }]
  }),
  serialize: (call) => ({ verb: call.verb }),
  parse: () => ({ verb: "lockIssue" }),
  send: async (_call, pass2) => await pass2.writer.lockIssue(pass2.item, pass2.allowance),
  async confirm(_call, pass2) {
    const seen = await pass2.reader.item(pass2.item);
    if (!seen.ok) return "unknown";
    return seen.value.locked ? "held" : "notHeld";
  }
};

// src/shell/apply/operations/postManagedComment.ts
var isManagedCommentKind2 = (value) => MANAGED_COMMENT_KINDS.includes(value);
var ITEM_COMMENT_BUDGET = 3;
var BUDGET_WINDOW_MS = 24 * 60 * 60 * 1e3;
function createdRecently(comments, now) {
  const since2 = now.getTime() - BUDGET_WINDOW_MS;
  return comments.filter(
    (comment) => (comment.authoredByApp || "recognized" in parseManagedMarker(comment.body)) && comment.createdAt !== void 0 && Date.parse(comment.createdAt) >= since2
  ).length;
}
var matchedComment = async (pass2, body) => {
  const mine = pass2.isMine(body);
  const listed2 = await pass2.reader.comments(pass2.item);
  if (!listed2.ok) return { ok: false, detail: `the comment read-back failed: ${listed2.detail}` };
  const found = listed2.value.find(mine);
  if (found !== void 0) return { ok: true, value: found };
  const confirmed = await pass2.reader.commentPresence(pass2.item, mine);
  if (confirmed === "absent") return { ok: true, value: null };
  return {
    ok: false,
    detail: confirmed === "present" ? "this comment's managed identity appeared between two reads" : "the read-back could not establish whether a comment under this identity exists"
  };
};
var postManagedComment2 = {
  verbs: ["postComment"],
  traits: { recordsWarning: true, activityRead: false },
  plan(effect) {
    if (effect.managedComment === null) {
      return {
        ok: false,
        code: "identityMissing",
        detail: "the approved effect carries no managed-comment identity to post under"
      };
    }
    return {
      ok: true,
      calls: [
        {
          verb: "postComment",
          kind: effect.intent.desired.kind,
          body: renderManagedBody(
            effect.managedComment.marker,
            effect.intent.desired.body
          )
        }
      ]
    };
  },
  serialize: (call) => ({ verb: call.verb, kind: call.kind, body: call.body }),
  parse(row2) {
    const kind = text2(row2, "kind");
    const body = text2(row2, "body");
    if (kind === null || !isManagedCommentKind2(kind) || body === null) return null;
    return { verb: "postComment", kind, body };
  },
  /**
   * D12, in full: no match creates, a match with the same body is `already`, and a match
   * with a different body is updated in place (D145). Nothing repairs a comment in the background — recovery's read-back matches on IDENTITY alone.
   */
  /** The day's creations, counted only when this call would create rather than rewrite (D232). */
  async hold(call, pass2) {
    const listed2 = await pass2.reader.comments(pass2.item);
    if (!listed2.ok || listed2.value.some(pass2.isMine(call.body))) return null;
    const created = createdRecently(listed2.value, pass2.clock());
    if (created < ITEM_COMMENT_BUDGET) return null;
    return {
      code: "commentBudget",
      detail: `${String(created)} managed comments were created on this item in the last day; the budget is ${String(ITEM_COMMENT_BUDGET)}`
    };
  },
  async send(call, pass2) {
    const found = await matchedComment(pass2, call.body);
    if (!found.ok) return { outcome: "retryLater", detail: found.detail };
    if (found.value === null)
      return await pass2.writer.createComment(pass2.item, call.body, pass2.allowance);
    if (found.value.body === call.body) return { outcome: "already" };
    return await pass2.writer.updateComment(found.value.id, call.body, pass2.allowance);
  },
  /** Confirms the exact body, so a lost update response cannot accept the old comment. */
  async confirm(call, pass2) {
    const found = await matchedComment(pass2, call.body);
    if (!found.ok) return "unknown";
    return found.value?.body === call.body ? "held" : "notHeld";
  }
};

// src/shell/apply/operations/releaseAssignment.ts
var releaseAssignment2 = {
  verbs: ["releaseAssignment"],
  traits: { recordsWarning: false, activityRead: false },
  /** Two calls, because a release is graced: the release, then its notice (grace.md §3). */
  plan: (effect) => planWithNotice(
    effect,
    { verb: "releaseAssignment", login: effect.intent.desired.login },
    effect.intent.grace?.notice.body ?? null
  ),
  serialize: (call) => ({ verb: call.verb, login: call.login }),
  parse(row2) {
    const login = text2(row2, "login");
    return login === null ? null : { verb: "releaseAssignment", login };
  },
  /** One named login, so the other assignees are left where they are (D63). */
  send: async (call, pass2) => await pass2.writer.releaseAssignment(pass2.item, call.login, pass2.allowance),
  /**
   * This login, gone from the list the item carries.
   * One read rather than D46's two: a stale list still naming the login answers `notHeld`, which asks again, so staleness cannot confirm a release that did not land.
   */
  async confirm(call, pass2) {
    const seen = await pass2.reader.assignees(pass2.item);
    if (!seen.ok) return "unknown";
    return seen.value.includes(call.login) ? "notHeld" : "held";
  }
};

// src/shell/apply/operations/unassign.ts
var unassign2 = {
  verbs: ["unassign"],
  traits: { recordsWarning: false, activityRead: false },
  /** The act, then the notice it carries — so the notice never announces a release that did not land. */
  plan: (effect) => planWithNotice(
    effect,
    { verb: "unassign", login: effect.intent.desired.login },
    effect.intent.desired.notice?.body ?? null
  ),
  serialize: (call) => ({ verb: call.verb, login: call.login }),
  parse(row2) {
    const login = text2(row2, "login");
    return login === null ? null : { verb: "unassign", login };
  },
  /** The release endpoint, one named login, so the other assignees stay where they are (D63, 6.10, 6.16). */
  send: async (call, pass2) => await pass2.writer.releaseAssignment(pass2.item, call.login, pass2.allowance),
  /** This login, gone from the list the item carries. */
  async confirm(call, pass2) {
    const seen = await pass2.reader.assignees(pass2.item);
    if (!seen.ok) return "unknown";
    return seen.value.includes(call.login) ? "notHeld" : "held";
  }
};

// src/shell/apply/operations/unlockIssue.ts
var unlockIssue2 = {
  verbs: ["unlockIssue"],
  traits: { recordsWarning: false, activityRead: false },
  plan: () => ({
    ok: true,
    calls: [{ verb: "unlockIssue" }]
  }),
  serialize: (call) => ({ verb: call.verb }),
  parse: () => ({ verb: "unlockIssue" }),
  send: async (_call, pass2) => await pass2.writer.unlockIssue(pass2.item, pass2.allowance),
  async confirm(_call, pass2) {
    const seen = await pass2.reader.item(pass2.item);
    if (!seen.ok) return "unknown";
    return seen.value.locked ? "notHeld" : "held";
  }
};

// src/shell/apply/operations/index.ts
var HANDLERS = {
  postManagedComment: postManagedComment2,
  applyMappedLabel: applyMappedLabel2,
  assign: assign2,
  unassign: unassign2,
  releaseAssignment: releaseAssignment2,
  closePullRequest: closePullRequest2,
  lockIssue: lockIssue2,
  unlockIssue: unlockIssue2
};
var handlerFor = (operation) => HANDLERS[operation];
var OWNER_OF_VERB = new Map(
  Object.entries(HANDLERS).flatMap(
    ([operation, handler]) => handler.verbs.map((verb) => [verb, operation])
  )
);
function operationOf(call) {
  return OWNER_OF_VERB.get(call.verb);
}
var traitsOf = (operation) => HANDLERS[operation].traits;
function serializeCall(journaled) {
  const { capability, item, call } = journaled;
  const head = { capability, item: { kind: item.kind, number: item.number } };
  const fields = handlerFor(operationOf(call)).serialize(call);
  return JSON.stringify({ ...head, ...fields });
}
var callOf = (row2) => {
  const verb = at(row2, "verb");
  const operation = typeof verb === "string" ? OWNER_OF_VERB.get(verb) : void 0;
  return operation === void 0 ? null : HANDLERS[operation].parse(row2);
};
function parseJournaledCall(row2) {
  let parsed2;
  try {
    parsed2 = JSON.parse(row2);
  } catch {
    return null;
  }
  const capability = text2(parsed2, "capability");
  const item = itemOf3(at(parsed2, "item"));
  const call = callOf(parsed2);
  if (capability === null || item === null || call === null) return null;
  return { capability, item, call };
}
function planFor(effect, config) {
  return handlerFor(effect.intent.operation).plan(effect, config);
}
var holdCall = async (call, pass2) => await handlerFor(operationOf(call)).hold?.(call, pass2) ?? null;
var sendCall = async (call, pass2) => await handlerFor(operationOf(call)).send(call, pass2);
var confirmCall = async (call, pass2) => await handlerFor(operationOf(call)).confirm(call, pass2);

// src/shell/apply/call.ts
var HOUR_MS3 = 60 * 60 * 1e3;
var stop = (outcome, code, detail) => ({ kind: "stop", result: { outcome, code, detail } });
var loginOf = (call) => "login" in call ? call.login : null;
var isMine = (body) => {
  const published = parseManagedMarker(body);
  const mine = "recognized" in published ? published.recognized : null;
  return (comment) => mine !== null && matchesManagedComment({ body: comment.body, authoredByApp: comment.authoredByApp }, mine).matches;
};
function createCalls(options) {
  const { ledger, writer, reader, clock } = options;
  const now = () => clock().toISOString();
  const contextFor = (pass2) => ({
    item: pass2.item,
    writer,
    reader,
    allowance: pass2.allowance,
    isMine,
    clock
  });
  const send = async (pass2, call) => await sendCall(call, contextFor(pass2));
  const confirm = async (pass2, call) => await confirmCall(call, contextFor(pass2));
  const appendFact = (pass2, kind, seq, call, said = {}) => {
    ledger.record({
      effectId: pass2.effectId,
      seq,
      kind,
      at: now(),
      revision: pass2.config.revision,
      capability: pass2.capability,
      repository: pass2.repository,
      item: pass2.item,
      verb: call?.verb ?? null,
      login: call === null ? null : loginOf(call),
      code: said.code ?? null,
      detail: said.detail ?? null,
      payload: said.payload ?? null
    });
  };
  const refuseCall = (pass2, seq, call, code, detail) => {
    appendFact(pass2, "refused", seq, call, { code, detail });
    return stop("refused", code, detail);
  };
  const record2 = (pass2, call) => {
    if (pass2.records === null || !traitsOf(operationOf(call)).recordsWarning) return;
    const warnedAt = clock();
    const { request } = pass2.records;
    const snapshot = {
      warnedAt: warnedAt.toISOString(),
      gracePeriodHours: pass2.records.gracePeriodHours,
      earliestActionAt: new Date(
        warnedAt.getTime() + pass2.records.gracePeriodHours * HOUR_MS3
      ).toISOString(),
      cancelledBy: pass2.records.cancelledBy,
      reversesWith: pass2.records.reversesWith,
      actionClass: request.actionClass,
      capability: request.capability,
      causeObservedAt: request.causeObservedAt.toISOString(),
      cause: request.cause,
      item: request.target.item,
      change: request.target.change
    };
    ledger.record({
      effectId: pass2.records.effectId,
      seq: 0,
      kind: "warned",
      at: snapshot.warnedAt,
      revision: pass2.config.revision,
      capability: pass2.capability,
      repository: pass2.repository,
      item: pass2.item,
      verb: null,
      login: null,
      code: null,
      detail: null,
      payload: JSON.stringify(snapshot)
    });
  };
  const land = (pass2, seq, call) => {
    appendFact(pass2, "landed", seq, call);
    record2(pass2, call);
  };
  return {
    /**
     * A definite refusal — conflict or forbidden — SETTLES the effect: nothing landed and nothing will, so leaving the send open would ask the sweep to re-decide a settled question.
     * A write no endpoint realises is `unsent` instead, spending no attempt: the send closes and the next pass resumes at the same call.
     */
    async sendCall(pass2, seq, call) {
      const spent = pass2.allowance?.exhausted() ?? null;
      if (spent === "mutations") {
        return stop(
          "refused",
          "sweepWriteCap",
          "this firing's write-call budget is spent; resumed next sweep"
        );
      }
      if (spent !== null) {
        return stop(
          "refused",
          "sweepRequestCap",
          `this window's ${spent} allowance is spent; resumed next sweep`
        );
      }
      const held2 = await holdCall(call, contextFor(pass2));
      if (held2 !== null) {
        appendFact(pass2, "unsent", seq, call, held2);
        return stop("refused", held2.code, held2.detail);
      }
      appendFact(pass2, "sent", seq, call, {
        payload: serializeCall({ capability: pass2.capability, item: pass2.item, call })
      });
      pass2.sent = true;
      const answer = await send(pass2, call);
      switch (answer.outcome) {
        case "applied": {
          const proof = await confirm(pass2, call);
          if (proof !== "held") {
            return stop(
              "unknown",
              "postconditionUnconfirmed",
              `GitHub accepted the ${call.verb} but the read-back answered ${proof}`
            );
          }
          land(pass2, seq, call);
          return { kind: "done", changed: true };
        }
        case "already":
          land(pass2, seq, call);
          return { kind: "done", changed: false };
        case "conflict":
          return refuseCall(pass2, seq, call, "writeConflict", answer.detail);
        case "forbidden":
          return refuseCall(pass2, seq, call, "writeForbidden", answer.detail);
        case "unsupported":
          appendFact(pass2, "unsent", seq, call, {
            code: "writeUnsupported",
            detail: answer.detail
          });
          return stop("refused", "writeUnsupported", answer.detail);
        case "retryLater":
          return stop("retryLater", "writeRetryLater", answer.detail);
        case "unknown":
          return stop("unknown", "writeUnknown", answer.detail);
      }
    },
    /** GitHub is asked before anything else: only a call it does not hold may be resent. */
    async readBack(pass2, seq, call) {
      const proof = await confirm(pass2, call);
      if (proof !== "held") return proof;
      land(pass2, seq, call);
      return "landed";
    },
    refuseCall,
    appendFact
  };
}

// src/shell/log.ts
var PROBLEM_EVENTS = /* @__PURE__ */ new Set([
  "deliveryConflict",
  "acceptFailed",
  "deliveryAttemptFailed",
  "deliveryDeadLettered",
  "orderingUnknown",
  "effectRefused",
  "effectAbandoned",
  "sweepRequeued",
  "sweepFailed",
  "configurationUnavailable",
  "scheduledCapabilityIdle",
  "sweepUnreadable",
  "snapshotUnreadable",
  "drainFailed",
  "storeCloseFailed"
]);
function detailOf2(error) {
  if (typeof error === "string") return error;
  try {
    if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
    return Object.prototype.toString.call(error);
  } catch {
    return "[unreadable thrown value]";
  }
}
function contained(log) {
  return (event) => {
    try {
      log(event);
    } catch {
    }
  };
}
function createLogger(options = {}) {
  const clock = options.clock ?? (() => /* @__PURE__ */ new Date());
  const out = options.out ?? ((line2) => void process.stdout.write(line2));
  const err2 = options.err ?? ((line2) => void process.stderr.write(line2));
  return (event) => {
    const line2 = `${JSON.stringify({ at: clock().toISOString(), ...event })}
`;
    if (PROBLEM_EVENTS.has(event.event)) err2(line2);
    else out(line2);
  };
}

// src/shell/apply/gates.ts
var refuse2 = (code, detail) => ({
  ok: false,
  result: { outcome: "refused", code, detail }
});
function projectionFrom(seen, kind, config) {
  const observation = {
    closedBy: seen.closed ? seen.merged ? "merged" : "closedByHuman" : null,
    meanings: meaningsOfLabels(config, seen.labels)
  };
  return kind === "issue" ? projectIssue(observation) : projectPullRequest(observation);
}
function recordedWarningsIn(ledger) {
  return (effectId) => {
    const row2 = ledger.warningFor(effectId);
    if (row2 === null) return null;
    return createDestructiveWarning({
      request: {
        capability: row2.capability,
        actionClass: row2.actionClass,
        requiredPermissions: [],
        cause: row2.cause,
        causeObservedAt: new Date(row2.causeObservedAt),
        target: { item: row2.item, change: row2.change }
      },
      warnedAt: new Date(row2.warnedAt),
      gracePeriodHours: row2.gracePeriodHours,
      earliestActionAt: new Date(row2.earliestActionAt),
      cancelledBy: row2.cancelledBy,
      reversesWith: row2.reversesWith
    });
  };
}
function createGates(options) {
  const { ledger, reader, externals, clock } = options;
  const warningFor = recordedWarningsIn(ledger);
  const activityCancels = (intent, live) => {
    const decided = intent.grace?.activityAt ?? null;
    const at2 = decided === null || live !== null && live.getTime() > decided.getTime() ? live : decided;
    const warning = warningFor(intent.idempotencyKey);
    return warning !== null && activitySinceWarning(at2, warning);
  };
  const freshExternals = async (payload) => {
    try {
      return { ok: true, value: await externals(payload) };
    } catch (error) {
      return { ok: false, detail: detailOf2(error) };
    }
  };
  const orderingFor2 = async (facts, item) => {
    try {
      return await facts.latestHumanChangeAt(item);
    } catch {
      return "unknown";
    }
  };
  const standingGate = (pass2, operation, facts) => {
    const operationFacts = INTENT_OPERATIONS[operation];
    const verdict = evaluateStandingRules(
      {
        capability: pass2.capability,
        actionClass: operationFacts.actionClassFloor,
        requiredPermissions: [operationFacts.permission]
      },
      pass2.config,
      {
        killSwitchActive: facts.killSwitchActive,
        installationGrants: facts.installationGrants
      }
    );
    return verdict.outcome === "apply" ? { ok: true } : refuse2(verdict.code, verdict.reason);
  };
  const modesClaimed = async (intent, seen) => {
    const claimed2 = intent.claims.pullRequestMode;
    if (claimed2 === void 0) return { ok: true, value: {} };
    if (claimed2 === "draft") return { ok: true, value: { draft: seen.draft } };
    const read = await reader.changesRequested(intent.item);
    return read.ok ? { ok: true, value: { changesRequested: read.value } } : read;
  };
  return {
    /**
     * The whole ladder again, against a LIVE read of the item.
     * This is what makes an approval a permission to act NOW rather than one banked at decision time. A mode that moved refuses under `preconditionStale`, as a meaning does.
     */
    async fresh(pass2, intent) {
      const seen = await reader.item(intent.item);
      if (!seen.ok) {
        return {
          ok: false,
          result: {
            outcome: "retryLater",
            code: "itemUnreadable",
            detail: `the item could not be read at apply time: ${seen.detail}`
          }
        };
      }
      const modes = await modesClaimed(intent, seen.value);
      if (!modes.ok) {
        return {
          ok: false,
          result: {
            outcome: "retryLater",
            code: "itemUnreadable",
            detail: `the pull request's mode could not be read at apply time: ${modes.detail}`
          }
        };
      }
      const facts = await freshExternals(pass2.payload);
      if (!facts.ok) {
        return {
          ok: false,
          result: {
            outcome: "retryLater",
            code: "externalsUnavailable",
            detail: `the apply-time externals could not be built: ${facts.detail}`
          }
        };
      }
      const request = writeRequestFor(intent);
      const activity = intent.grace !== null && traitsOf(intent.operation).activityRead ? await reader.pullRequestActivity(
        intent.item,
        pass2.config.mappings.commands.working
      ) : { ok: true, value: null };
      if (!activity.ok) {
        return {
          ok: false,
          result: {
            outcome: "retryLater",
            code: "itemUnreadable",
            detail: `the pull request's activity could not be read at apply time: ${activity.detail}`
          }
        };
      }
      const context = {
        killSwitchActive: facts.value.killSwitchActive,
        installationGrants: facts.value.installationGrants,
        latestHumanChangeAt: await orderingFor2(facts.value, intent.item),
        world: deriveWorld(
          projectionFrom(seen.value, intent.item.kind, pass2.config),
          intent.claims,
          modes.value
        )
      };
      const verdict = intent.grace === null ? evaluateWrite(request, pass2.config, context) : evaluateDestructive(
        {
          request,
          warning: warningFor(intent.idempotencyKey),
          qualifyingActivitySinceWarning: activityCancels(
            intent,
            activity.value
          )
        },
        pass2.config,
        context,
        clock()
      );
      return verdict.outcome === "apply" ? { ok: true } : refuse2(verdict.code, verdict.reason);
    },
    /** The standing gate, over externals read fresh for this pass. */
    async resume(pass2, operation) {
      const facts = await freshExternals(pass2.payload);
      return facts.ok ? standingGate(pass2, operation, facts.value) : {
        ok: false,
        result: {
          outcome: "retryLater",
          code: "externalsUnavailable",
          detail: `the apply-time externals could not be built: ${facts.detail}`
        }
      };
    }
  };
}

// src/shell/apply/apply.ts
var EFFECT_LEASE_STALE_MINUTES = 10;
var EFFECT_ATTEMPT_CAP = 5;
var heldBack = ({ intent }, lane) => ({
  effectId: intent.idempotencyKey,
  capability: intent.capability,
  operation: intent.operation,
  item: intent.item,
  outcome: "refused",
  code: lane === "mutations" ? "sweepWriteCap" : "sweepRequestCap",
  detail: lane === "mutations" ? "this firing's write cap is spent; decided again next sweep" : `this window's ${lane} allowance is spent; decided again next sweep`
});
function createApplier(options) {
  const { ledger, writer, reader, externals, worker, clock, log } = options;
  const now = () => clock().toISOString();
  const gates = createGates({ ledger, reader, externals, clock });
  const calls = createCalls({ ledger, writer, reader, clock });
  const claim = (effectId) => {
    const at2 = clock();
    return ledger.claim(
      effectId,
      worker,
      at2.toISOString(),
      new Date(at2.getTime() - EFFECT_LEASE_STALE_MINUTES * 6e4).toISOString()
    );
  };
  const sendOf = (effectId) => {
    const sends = ledger.factsOf(effectId).filter((fact) => fact.kind === "sent");
    return sends[sends.length - 1];
  };
  const underSameRevision = (pass2) => sendOf(pass2.effectId).revision === pass2.config.revision;
  const sendAt = async (pass2, seq, plan) => {
    const step = await calls.sendCall(pass2, seq, plan[seq - 1]);
    if (step.kind === "done") pass2.changed ||= step.changed;
    return step;
  };
  const resolveOne = async (pass2, seq, call, revision) => {
    const back = await calls.readBack(pass2, seq, call);
    if (back === "landed") {
      pass2.changed = true;
      return { kind: "done", changed: true };
    }
    if (back === "unknown") {
      return stop(
        "unknown",
        "writeUnknown",
        "the read-back could not establish whether this call landed"
      );
    }
    if (revision !== pass2.config.revision) {
      return calls.refuseCall(
        pass2,
        seq,
        call,
        "configurationChanged",
        "the configuration changed after this call was recorded; nothing was resent"
      );
    }
    const gate = await gates.resume(pass2, operationOf(call));
    if (!gate.ok) {
      if (gate.result.outcome === "refused") {
        calls.appendFact(pass2, "refused", seq, call, gate.result);
      }
      return { kind: "stop", result: gate.result };
    }
    const step = await calls.sendCall(pass2, seq, call);
    if (step.kind === "done") pass2.changed = true;
    return step;
  };
  const resolve = async (pass2, seq, payload) => {
    const journaled = payload === null ? null : parseJournaledCall(payload);
    if (journaled === null) {
      const detail = "the ledger's bytes for this call could not be read; it is closed and nothing was resent";
      calls.appendFact(pass2, "refused", seq, null, { code: "rowUnreadable", detail });
      return stop("refused", "rowUnreadable", detail);
    }
    return await resolveOne(pass2, seq, journaled.call, sendOf(pass2.effectId).revision);
  };
  const perform = async (action, pass2, intent, plan) => {
    switch (action.kind) {
      case "stop":
        return { kind: "stop", result: action.result };
      case "resolve":
        return await resolve(pass2, action.seq, action.payload);
      case "send":
        return await sendAt(pass2, action.seq, plan);
      case "fresh": {
        const gate = await gates.fresh(pass2, intent);
        if (!gate.ok) return { kind: "stop", result: gate.result };
        pass2.gated = true;
        return await sendAt(pass2, action.seq, plan);
      }
      case "resume": {
        if (!underSameRevision(pass2)) {
          return stop(
            "refused",
            "configurationChanged",
            pass2.changed ? "the configuration changed after this effect started; nothing else was sent" : "the configuration changed after this effect started; nothing was resumed"
          );
        }
        const gate = await gates.resume(pass2, intent.operation);
        if (!gate.ok) return { kind: "stop", result: gate.result };
        pass2.gated = true;
        pass2.changed ||= action.seq > 1;
        return await sendAt(pass2, action.seq, plan);
      }
    }
  };
  const drive = async (pass2, intent, plan) => {
    for (; ; ) {
      const state = ledger.stateOf(pass2.effectId, plan.length);
      const action = actionFor(state, pass2);
      const step = await perform(action, pass2, intent, plan);
      if (step.kind === "stop") return step.result;
    }
  };
  const apply = async (effect, config, allowance, payload) => {
    const { intent } = effect;
    const pass2 = {
      effectId: intent.idempotencyKey,
      capability: intent.capability,
      repository: intent.repository,
      item: intent.item,
      config,
      records: effect.records,
      allowance,
      payload,
      gated: false,
      changed: false,
      sent: false
    };
    const outcomeOf2 = (result) => ({
      effectId: pass2.effectId,
      capability: pass2.capability,
      operation: intent.operation,
      item: pass2.item,
      ...result
    });
    const plan = planFor(effect, config);
    if (!plan.ok) {
      return outcomeOf2({ outcome: "refused", code: plan.code, detail: plan.detail });
    }
    if (!claim(pass2.effectId)) {
      return outcomeOf2({
        outcome: "unknown",
        code: "leaseHeld",
        detail: "a live worker holds this effect's lease"
      });
    }
    try {
      return outcomeOf2(await drive(pass2, intent, plan.calls));
    } finally {
      ledger.release(pass2.effectId, worker);
    }
  };
  return {
    async applyAll(effects, config, allowance, payload) {
      const outcomes = [];
      for (const effect of effects) {
        const spent = allowance?.exhausted() ?? null;
        outcomes.push(
          spent === null ? await apply(effect, config, allowance, payload) : heldBack(effect, spent)
        );
      }
      return outcomes;
    },
    /**
     * One open send the sweep found, resolved and reported.
     * Log-only, and a send still open at the end says nothing: the sweep meets it again.
     */
    async recover(open, config) {
      const journaled = open.payload === null ? null : parseJournaledCall(open.payload);
      if (journaled === null) {
        const sent = sendOf(open.effectId);
        const detail = "the ledger's bytes could not be read; it is closed and nothing was resent";
        ledger.record({
          ...sent,
          kind: "refused",
          at: now(),
          code: "rowUnreadable",
          detail,
          payload: null
        });
        log({
          event: "effectRefused",
          effectId: open.effectId,
          seq: open.seq,
          code: "rowUnreadable",
          detail
        });
        return;
      }
      const pass2 = {
        effectId: open.effectId,
        capability: journaled.capability,
        repository: open.repository,
        item: journaled.item,
        config,
        records: null,
        allowance: void 0,
        payload: void 0,
        gated: false,
        changed: false,
        sent: false
      };
      if (open.attempts >= EFFECT_ATTEMPT_CAP) {
        calls.appendFact(pass2, "abandoned", open.seq, journaled.call, {
          code: "effectAbandoned",
          detail: `this call was sent ${String(open.attempts)} times and nothing more is sent`
        });
        log({
          event: "effectAbandoned",
          effectId: open.effectId,
          seq: open.seq,
          attempts: open.attempts
        });
        return;
      }
      if (!claim(open.effectId)) return;
      try {
        const resolved = await resolveOne(pass2, open.seq, journaled.call, open.revision);
        if (resolved.kind === "done") {
          log({ event: "effectApplied", effectId: open.effectId, seq: open.seq });
        } else if (resolved.result.outcome === "refused") {
          log({
            event: "effectRefused",
            effectId: open.effectId,
            seq: open.seq,
            code: resolved.result.code,
            detail: resolved.result.detail
          });
        }
      } finally {
        ledger.release(open.effectId, worker);
      }
    }
  };
}

// src/shell/decide/decisions.ts
var SKIPPED = "capabilitySkipped";
var ON_THE_CAPABILITY = {
  capabilityExplained: SKIPPED,
  capabilityFailed: "capabilityFailed",
  resolverFailed: "resolverFailed",
  undeclaredResolver: "undeclaredResolver",
  intentsAfterSkip: "intentsAfterSkip"
};
var aboutAnItem = (finding2) => finding2.subject.kind === "item" || finding2.subject.kind === "effect";
var aboutTheCapability = (finding2) => finding2.subject.kind === "capability";
var reasonOf = (finding2) => finding2.detail.length === 0 ? finding2.summary : `${finding2.summary} (${finding2.detail.join("; ")})`;
function decisionsOf(pass2) {
  const common = {
    passId: pass2.passId,
    source: pass2.source,
    sourceId: pass2.sourceId,
    at: pass2.at,
    repository: pass2.repository,
    effectId: null
  };
  const rowOf2 = (finding2) => {
    if (aboutAnItem(finding2)) {
      return {
        ...common,
        item: finding2.subject.item,
        capability: finding2.subject.capability,
        verdict: finding2.severity,
        code: finding2.code,
        detail: finding2.summary
      };
    }
    if (pass2.item === null || !aboutTheCapability(finding2)) return null;
    const code = ON_THE_CAPABILITY[finding2.code];
    if (code === void 0) return null;
    return {
      ...common,
      item: pass2.item,
      capability: finding2.subject.capability,
      verdict: finding2.severity,
      code,
      detail: reasonOf(finding2)
    };
  };
  return [
    ...pass2.report.findings.map(rowOf2).filter((row2) => row2 !== null),
    ...pass2.effects.map((outcome) => ({
      ...common,
      item: outcome.item,
      capability: outcome.capability,
      verdict: outcome.outcome,
      code: outcome.code,
      detail: outcome.detail,
      effectId: outcome.effectId
    }))
  ];
}

// src/shell/decide/item.ts
var MODE_UNSUPPORTED = "active mode is unsupported by the runnable shell";
var askedOf = (input, repository) => input.kind === "delivery" ? {
  kind: "delivery",
  repository,
  event: input.event,
  payload: input.payload,
  deliveryId: input.deliveryId
} : { kind: "facts", facts: input.facts };
function passOf(input) {
  if (input.kind === "delivery") {
    return { passId: input.deliveryId, source: "webhook", sourceId: input.deliveryId };
  }
  return { passId: input.scheduleId, source: "sweep", sourceId: input.scheduleId };
}
function createItemDecider(options) {
  const { store: store2, capabilities: capabilities2, externals, repository, clock, applier } = options;
  const warningFor = recordedWarningsIn(store2.ledger);
  const externalsFor = async (delivery, evaluatedAt) => {
    const given = await externals(delivery);
    return { ...given, warningFor: given.warningFor ?? warningFor, evaluatedAt };
  };
  const decideOn = async (input, config, passId, evaluatedAt) => decide(
    askedOf(input, repository),
    config,
    capabilities2,
    // Built per item: the live path binds its ordering-evidence memo to this one.
    await externalsFor(
      {
        payload: input.kind === "delivery" ? input.payload : void 0,
        deliveryId: passId,
        config
      },
      evaluatedAt
    )
  );
  return async (input, config, at2, allowance) => {
    const active = config.mode === "active";
    if (active && applier === void 0) {
      return { kind: "modeUnsupported", reason: MODE_UNSUPPORTED };
    }
    const pass2 = passOf(input);
    const decision = await decideOn(input, config, pass2.passId, clock());
    const outcomes = active && applier !== void 0 ? await applier.applyAll(
      decision.approved,
      config,
      allowance,
      // Stryker disable next-line ConditionalExpression: a swept record has no payload to pass.
      input.kind === "delivery" ? input.payload : void 0
    ) : [];
    const rows = decisionsOf({
      ...pass2,
      repository,
      item: decision.item,
      at: at2,
      report: decision.report,
      effects: outcomes
    });
    for (const row2 of rows) store2.ledger.decide(row2);
    return { kind: "decided", report: decision.report, outcomes };
  };
}

// src/shell/decide/schedule.ts
var SWEEP_EFFECT = "sweep";
function sweepScheduleId(repository) {
  return `${SWEEP_EFFECT}:${repository.owner}/${repository.repo}`;
}
function repositoryOfScheduleId(scheduleId) {
  const prefix = `${SWEEP_EFFECT}:`;
  if (!scheduleId.startsWith(prefix)) return null;
  const [owner, repo, ...rest] = scheduleId.slice(prefix.length).split("/");
  return owner && repo && rest.length === 0 ? { owner, repo } : null;
}
function wantsSweeping(config, capabilities2) {
  return capabilities2.some(
    ({ declaration }) => config.capabilities[declaration.name]?.enabled === true && declaration.triggers.some((trigger) => trigger.kind === "schedule")
  );
}
function declareSweep({
  store: store2,
  repository,
  config,
  capabilities: capabilities2,
  now
}) {
  if (!wantsSweeping(config, capabilities2)) return;
  store2.ledger.schedule(sweepScheduleId(repository), now.toISOString(), SWEEP_EFFECT);
}

// src/shell/decide/warnings.ts
var HOUR_MS4 = 60 * 60 * 1e3;
function instantOf2(value) {
  if (value === void 0) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
function warnedInstantOf(comment) {
  const created = instantOf2(comment.createdAt);
  const updated = instantOf2(comment.updatedAt);
  if (created === null) return null;
  return updated !== null && updated > created ? updated : created;
}
async function hydrateWarnings(options) {
  const { ledger, reader, repository, item, revision } = options;
  const read = await reader.comments(item);
  if (!read.ok) return 0;
  let offered = 0;
  for (const comment of read.value) {
    if (!comment.authoredByApp) continue;
    const reading = parseManagedMarker(comment.body);
    if (!("recognized" in reading) || reading.recognized.record === void 0) continue;
    const warnedAt = warnedInstantOf(comment);
    if (warnedAt === null) continue;
    const { record: record2 } = reading.recognized;
    const snapshot = {
      warnedAt,
      gracePeriodHours: record2.gracePeriodHours,
      earliestActionAt: new Date(
        Date.parse(warnedAt) + record2.gracePeriodHours * HOUR_MS4
      ).toISOString(),
      cancelledBy: record2.cancelledBy,
      reversesWith: record2.reversesWith,
      actionClass: record2.actionClass,
      capability: record2.capability,
      causeObservedAt: record2.causeObservedAt,
      cause: record2.cause,
      item: record2.item,
      change: record2.change
    };
    ledger.record({
      effectId: record2.effectId,
      seq: 0,
      kind: "warned",
      at: warnedAt,
      revision,
      capability: record2.capability,
      repository,
      item,
      verb: null,
      login: null,
      code: null,
      detail: null,
      payload: JSON.stringify(snapshot)
    });
    offered += 1;
  }
  return offered;
}

// src/shell/inbound/deliveries.ts
var STALE_CLAIM_MINUTES = 15;
var MAX_DELIVERY_ATTEMPTS = 5;
var RETRY_BASE_MS = 3e4;
var RETRY_CEILING_MS = 60 * 6e4;
function retryDelayMs(attempts) {
  return Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_CEILING_MS);
}
var CONFIG_NOT_CONSULTED_REVISION = "sha256:unconsulted";
function parsePayload(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return void 0;
  }
}
var ANY_REPOSITORY = "any";
var NO_REPOSITORY = "none";
function repositorySpelledBy(repository) {
  return `${repository.owner}/${repository.repo}`;
}
function sameRepository(named2, served) {
  return named2.toLowerCase() === served.toLowerCase();
}
function dispositionOf(release2) {
  const common = { disposition: release2.outcome, maxAttempts: MAX_DELIVERY_ATTEMPTS };
  switch (release2.outcome) {
    case "retryScheduled":
      return {
        ...common,
        attempts: release2.attempts,
        retryNotBefore: release2.retryNotBefore
      };
    case "deadLettered":
      return { ...common, attempts: release2.attempts, retryNotBefore: null };
    case "notOwned":
      return { ...common, attempts: null, retryNotBefore: null };
  }
}
function undecidedDetail(record2) {
  switch (record2.kind) {
    case "configRejected":
      return record2.errors.map(
        (error) => `${error.code}${error.path === null ? "" : ` at ${error.path}`}: ${error.message}`
      ).join("; ");
    case "repositoryMismatch":
      return `expected ${record2.expected}, observed ${record2.observed}`;
    case "modeUnsupported":
      return record2.reason;
    default:
      return void 0;
  }
}
function createDeliveries(options) {
  const {
    store: store2,
    capabilities: capabilities2,
    lane,
    repository,
    allowance,
    worker,
    clock,
    log,
    suspended = false,
    configured
  } = options;
  let draining = null;
  const claimNext = () => {
    const now = clock();
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_MINUTES * 6e4);
    return store2.inbox.claimNextDelivery(worker, now.toISOString(), staleBefore.toISOString());
  };
  const loadConfig = async (configSource) => {
    const loaded = await configSource.load();
    if (!loaded.ok) {
      if (loaded.permanent) {
        return {
          revision: loaded.revision ?? UNREADABLE_CONFIG_REVISION,
          result: {
            ok: false,
            // documentUnparseable, not a new code: the catalogue only admits codes a DOCUMENT can reach (D76).
            errors: [
              {
                code: "documentUnparseable",
                message: `unreadable before parsing: ${loaded.detail}`,
                path: null
              }
            ]
          }
        };
      }
      throw new Error(`configuration unavailable: ${loaded.detail}`);
    }
    const { document } = loaded;
    return {
      revision: document.revision,
      result: parseConfigDocument(document.text, {
        revision: document.revision,
        // Full declarations, not names: the parser reads each settings block against its own spec.
        knownCapabilities: capabilities2.map((c) => c.declaration)
      })
    };
  };
  const identityFor = (claimed2, configRevision, decidedAt) => ({
    // The branded GUID becomes plain text here: records are JSON.
    deliveryId: String(claimed2.deliveryId),
    event: claimed2.eventName,
    receivedAt: claimed2.receivedAt,
    decidedAt: decidedAt.toISOString(),
    configRevision
  });
  const served = repository === void 0 ? ANY_REPOSITORY : repositorySpelledBy(repository);
  const recordFor = async (claimed2) => {
    const payload = parsePayload(claimed2.payload);
    const spelled3 = repositoryNamedBy(payload);
    const observed = spelled3 === null ? NO_REPOSITORY : repositorySpelledBy(spelled3);
    const unserved = spelled3 === null || repository !== void 0 && !sameRepository(observed, served);
    if (unserved) {
      return {
        kind: "repositoryMismatch",
        ...identityFor(claimed2, CONFIG_NOT_CONSULTED_REVISION, clock()),
        expected: served,
        observed
      };
    }
    if (suspended) {
      return {
        kind: "installationSuspended",
        ...identityFor(claimed2, CONFIG_NOT_CONSULTED_REVISION, clock())
      };
    }
    const named2 = repository ?? spelled3;
    const { configSource, decideItem } = lane(named2);
    const config = await loadConfig(configSource);
    const identity = identityFor(claimed2, config.revision, clock());
    if (!config.result.ok) {
      return { kind: "configRejected", ...identity, errors: config.result.errors };
    }
    const parsed2 = config.result.config;
    declareSweep({ store: store2, repository: named2, config: parsed2, capabilities: capabilities2, now: clock() });
    configured?.(named2, parsed2);
    const decided = await decideItem(
      {
        kind: "delivery",
        deliveryId: identity.deliveryId,
        event: identity.event,
        payload
      },
      parsed2,
      identity.decidedAt,
      allowance
    );
    return decided.kind === "modeUnsupported" ? { kind: "modeUnsupported", ...identity, reason: decided.reason } : { kind: "decision", ...identity, report: decided.report, effects: decided.outcomes };
  };
  const recordFailure = (claimed2, refusal2) => {
    const failedAt = clock();
    const ladder2 = new Date(failedAt.getTime() + retryDelayMs(claimed2.attempts)).toISOString();
    return store2.inbox.releaseDeliveryAfterFailure({
      deliveryId: claimed2.deliveryId,
      claimToken: claimed2.claimToken,
      failedAt: failedAt.toISOString(),
      retryNotBefore: refusal2?.resetAt ?? ladder2,
      maxAttempts: MAX_DELIVERY_ATTEMPTS
    });
  };
  const refusedSince = (turnedAway) => {
    if (allowance === void 0 || allowance.refusals() === turnedAway) return null;
    return allowance.lastRefusal();
  };
  const notCompleted = (claimed2, error, refusal2) => {
    const deliveryId = String(claimed2.deliveryId);
    const release2 = recordFailure(claimed2, refusal2);
    log({
      event: "deliveryAttemptFailed",
      deliveryId,
      ...dispositionOf(release2),
      ...refusal2 === null ? {} : { pool: refusal2.lane },
      detail: detailOf2(error)
    });
    if (release2.outcome === "deadLettered") {
      log({ event: "deliveryDeadLettered", deliveryId, attempts: release2.attempts });
    }
    return { kind: "failed", deliveryId, error, release: release2 };
  };
  const attemptNext = async () => {
    const claimed2 = claimNext();
    if (claimed2 === void 0) return { kind: "idle" };
    const deliveryId = String(claimed2.deliveryId);
    log({
      event: "deliveryClaimed",
      deliveryId,
      eventName: claimed2.eventName,
      attempts: claimed2.attempts
    });
    const turnedAway = allowance?.refusals() ?? 0;
    try {
      const record2 = await recordFor(claimed2);
      const refusal2 = refusedSince(turnedAway);
      if (refusal2 !== null) {
        const spent = new Error(
          `the webhook lane's ${refusal2.lane} allowance refused a read`
        );
        return notCompleted(claimed2, spent, refusal2);
      }
      const completion = store2.inbox.completeDelivery({
        deliveryId: claimed2.deliveryId,
        eventName: claimed2.eventName,
        payloadDigest: claimed2.payloadDigest,
        claimToken: claimed2.claimToken,
        completedAt: clock().toISOString()
      });
      if (completion.outcome !== "completed") {
        throw new Error(`delivery was not completed: ${completion.outcome}`);
      }
      const detail = undecidedDetail(record2);
      log({
        event: "deliveryCompleted",
        deliveryId,
        kind: record2.kind,
        ...detail === void 0 ? {} : { detail }
      });
      return { kind: "completed" };
    } catch (error) {
      return notCompleted(claimed2, error, refusedSince(turnedAway));
    }
  };
  return {
    /** One pass. A failed delivery still throws: the caller asked for it. */
    async processOnce() {
      const outcome = await attemptNext();
      if (outcome.kind === "failed") throw outcome.error;
      return outcome.kind === "completed";
    },
    /**
     * Process until the queue is empty, stepping OVER a failed delivery: it is backed
     * off or dead-lettered by then. The one failure that ends the pass early is a lost claim — the attempt went uncounted, so a loop that cannot prove progress stops.
     */
    drain() {
      draining ??= (async () => {
        try {
          for (; ; ) {
            const outcome = await attemptNext();
            if (outcome.kind === "idle") return;
            if (outcome.kind === "failed" && outcome.release.outcome === "notOwned") {
              return;
            }
          }
        } finally {
          draining = null;
        }
      })();
      return draining;
    },
    /**
     * What a shutdown waits for. It cannot be `drain()`: with no pass in flight that
     * would START one, claiming work the process is about to walk away from.
     */
    settled() {
      return draining ?? Promise.resolve();
    },
    /**
     * A read, never a decision: an unanswerable source and an unparsable file are both
     * `null`, because the sweep's response to either is the same.
     */
    async configuration(repository2, source) {
      try {
        const loaded = await loadConfig(source ?? lane(repository2).configSource);
        if (loaded.result.ok) return loaded.result.config;
        log({
          event: "configurationUnavailable",
          reason: "rejected",
          detail: loaded.result.errors.map((error) => `${error.code}: ${error.message}`).join("; ")
        });
        return null;
      } catch (error) {
        log({
          event: "configurationUnavailable",
          reason: "unreadable",
          detail: error instanceof Error ? error.message : String(error)
        });
        return null;
      }
    }
  };
}

// src/shell/sweep/budgets.ts
var DEFAULT_SWEEP_CADENCE_MS = 60 * 6e4;
var SWEEP_WRITE_CALLS = 20;
var REVIEW_SETTLE_MS = 6e4;
var SNAPSHOT_MAX_AGE_MS = 24 * 60 * 6e4;

// src/shell/sweep/sweep.ts
var DAY_MS = 24 * 60 * 6e4;
var NOTHING = { core: 0, graphql: 0, mutations: 0 };
var since = (before, after) => ({
  core: after.core - before.core,
  graphql: after.graphql - before.graphql,
  mutations: after.mutations - before.mutations
});
var DONE_DELIVERY_RETENTION_DAYS = 30;
var DECISION_RETENTION_DAYS = 30;
var SETTLED_EFFECT_RETENTION_DAYS = 90;
var nothingRead = (row2, spent = NOTHING) => ({
  items: 0,
  decided: 0,
  unread: 0,
  writes: 0,
  heldBack: 0,
  remaining: 0,
  resumeAfter: row2.resumeAfter,
  reused: 0,
  spent,
  deferred: false,
  partial: false
});
var deferred = (row2, spent = NOTHING) => ({
  ...nothingRead(row2, spent),
  deferred: true
});
var heldBackIn = (decided) => decided.kind === "decided" ? decided.outcomes.filter(
  (outcome) => outcome.code === "sweepRequestCap" || outcome.code === "sweepWriteCap"
).length : 0;
function afterCursor(items, after) {
  return items.filter(({ item }) => after === null || item.number > after).sort((left, right) => left.item.number - right.item.number);
}
function storedOf(record2, groups, closes) {
  const held2 = record2;
  const kept = Object.fromEntries(keptOn(record2.kind).map((group) => [group, held2[group]]));
  return record2.kind === "issue" ? { kind: "issue", groups, ...kept } : { kind: "pullRequest", groups, ...kept, closes };
}
function undrivable(row2) {
  return row2.effect === SWEEP_EFFECT ? `schedule "${row2.scheduleId}" names no repository` : `schedule "${row2.scheduleId}" carries the unknown effect "${row2.effect}"`;
}
function createSweep(options) {
  const {
    store: store2,
    capabilities: capabilities2,
    processorFor,
    clock,
    cadenceMs,
    writeCap,
    allowance,
    snapshotMaxAgeMs = SNAPSHOT_MAX_AGE_MS,
    suspended = false,
    log
  } = options;
  const nextDue = () => new Date(clock().getTime() + cadenceMs).toISOString();
  const readsStalled = () => {
    const lane = allowance.exhausted();
    return lane === "core" || lane === "graphql";
  };
  const groupsFor = (config) => ({
    issue: groupsNeeded(config, capabilities2, "issue"),
    pullRequest: groupsNeeded(config, capabilities2, "pullRequest")
  });
  const answers = (stored, groups) => snapshotAnswers(stored, groups[stored.kind]) && (stored.kind === "issue" || !groups.issue.includes("links") || stored.closes !== UNREAD);
  const stillStands = (snapshot, listed2, readAt) => snapshot.updatedAt === listed2.updatedAt.toISOString() && listed2.updatedAt.getTime() < readAt - REVIEW_SETTLE_MS && Date.parse(snapshot.readAt) > readAt - snapshotMaxAgeMs;
  const standingReads = (repository, items, groups, readAt) => {
    const held2 = /* @__PURE__ */ new Map();
    let unreadable2 = 0;
    for (const listed2 of items) {
      const snapshot = store2.ledger.snapshotOf(repository, listed2.item);
      if (snapshot === null || !stillStands(snapshot, listed2, readAt)) continue;
      const stored = decodeSnapshot(snapshot.facts);
      if (stored === null) {
        unreadable2 += 1;
        continue;
      }
      if (stored.kind === listed2.item.kind && answers(stored, groups)) {
        held2.set(listed2.item.number, stored);
      }
    }
    return { held: held2, unreadable: unreadable2 };
  };
  const readRecords = async (row2, repository, config, processor, before) => {
    const spent = () => since(before, allowance.spent());
    const groups = groupsFor(config);
    const reader = processor.facts(config, groups);
    const listed2 = await reader.openItems();
    if (!listed2.ok) {
      log({ event: "sweepUnreadable", scheduleId: row2.scheduleId, detail: listed2.detail });
      return nothingRead(row2, spent());
    }
    const readAt = clock();
    store2.ledger.dropSnapshotsNotIn(
      repository,
      listed2.items.map(({ item }) => item.number)
    );
    const standing3 = standingReads(repository, listed2.items, groups, readAt.getTime());
    if (standing3.unreadable > 0) {
      log({
        event: "snapshotUnreadable",
        scheduleId: row2.scheduleId,
        rows: standing3.unreadable
      });
    }
    const eligible = afterCursor(listed2.items, row2.resumeAfter);
    const issues = listed2.items.filter(({ item }) => item.kind === "issue");
    const closes = /* @__PURE__ */ new Map();
    for (const [number, held2] of standing3.held) {
      if (held2.kind === "pullRequest") closes.set(number, held2.closes);
    }
    const fresh = await reader.linksFor(
      listed2.items.filter(({ item }) => item.kind === "pullRequest" && !closes.has(item.number)).map(({ item }) => item.number)
    );
    for (const [number, closing2] of fresh) closes.set(number, closing2);
    const inverse = /* @__PURE__ */ new Map();
    let linksUnread = false;
    for (const [number, closing2] of closes) {
      if (closing2 === "unread") {
        linksUnread = true;
        continue;
      }
      for (const issue of closing2) {
        const held2 = inverse.get(issue.number) ?? [];
        held2.push({ kind: "pullRequest", number });
        inverse.set(issue.number, held2);
      }
    }
    const openPullRequestsOf = (number) => linksUnread ? "unread" : inverse.get(number) ?? [];
    const recordOf4 = (listedItem, stored) => {
      const { kind, number } = listedItem.item;
      return kind === "issue" ? reader.issueFacts(
        listedItem,
        openPullRequestsOf(number),
        stored?.kind === "issue" ? stored : void 0
      ) : reader.pullRequestFacts(
        listedItem,
        issues,
        closes.get(number) ?? "unread",
        stored?.kind === "pullRequest" ? stored : void 0
      );
    };
    const records = [];
    let read = 0;
    let reused = 0;
    for (const listedItem of eligible) {
      if (readsStalled()) break;
      const turnedAway = allowance.refusals();
      const { kind, number } = listedItem.item;
      const stored = standing3.held.get(number);
      const record2 = await recordOf4(listedItem, stored);
      if (allowance.refusals() > turnedAway) break;
      read += 1;
      records.push(record2);
      if (stored !== void 0) {
        reused += 1;
        continue;
      }
      store2.ledger.putSnapshot(repository, {
        item: listedItem.item,
        updatedAt: listedItem.updatedAt.toISOString(),
        readAt: readAt.toISOString(),
        facts: encodeSnapshot(storedOf(record2, groups[kind], closes.get(number) ?? UNREAD))
      });
    }
    const reading = spent();
    const remaining = eligible.length - read;
    const resumeAfter = remaining === 0 ? null : eligible[read - 1]?.item.number ?? row2.resumeAfter;
    let decided = 0;
    let unread = 0;
    let heldBack2 = 0;
    for (const record2 of records) {
      if (groups[record2.kind].some((group) => factGroupUnread(record2, group))) unread += 1;
      const answer = await processor.decideItem(
        { kind: "facts", scheduleId: row2.scheduleId, facts: record2 },
        config,
        row2.dueAt,
        allowance
      );
      heldBack2 += heldBackIn(answer);
      decided += 1;
    }
    if (resumeAfter !== null) {
      log({
        event: "sweepPartial",
        scheduleId: row2.scheduleId,
        read,
        remaining,
        resumeAfter,
        requests: reading.core
      });
    }
    const total = spent();
    return {
      items: listed2.items.length,
      decided,
      unread,
      writes: total.mutations,
      heldBack: heldBack2,
      remaining,
      resumeAfter,
      reused,
      spent: total,
      deferred: false,
      partial: resumeAfter !== null
    };
  };
  const pruneRetained = () => {
    try {
      const now = clock().getTime();
      const before = (days) => new Date(now - days * DAY_MS).toISOString();
      const deliveries = store2.inbox.pruneCompletedDeliveries(
        before(DONE_DELIVERY_RETENTION_DAYS)
      );
      const effects = store2.ledger.prune(before(SETTLED_EFFECT_RETENTION_DAYS));
      const decisions = store2.ledger.pruneDecisions(before(DECISION_RETENTION_DAYS));
      if (deliveries > 0 || effects > 0 || decisions > 0) {
        log({ event: "sweepPruned", deliveries, effects, decisions });
      }
    } catch (error) {
      log({ event: "sweepFailed", detail: detailOf2(error) });
    }
  };
  const readingOf = async (row2, repository, processor) => {
    if (suspended) {
      log({ event: "sweepSuspended", scheduleId: row2.scheduleId });
      return nothingRead(row2);
    }
    if (allowance.exhausted() !== null) return deferred(row2);
    const before = allowance.spent();
    const spent = () => since(before, allowance.spent());
    try {
      const config = await processor.configuration();
      if (allowance.exhausted() !== null) return deferred(row2, spent());
      if (config !== null && wantsSweeping(config, capabilities2)) {
        return await readRecords(row2, repository, config, processor, before);
      }
    } catch (error) {
      log({ event: "sweepFailed", detail: detailOf2(error) });
    }
    return nothingRead(row2, spent());
  };
  const fire = async (row2, repository) => {
    const startedAt2 = clock().toISOString();
    log({ event: "sweepClaimed", scheduleId: row2.scheduleId, dueAt: row2.dueAt });
    const swept = await readingOf(row2, repository, processorFor(repository, allowance));
    pruneRetained();
    const { partial, ...result } = swept;
    const nextDueAt = swept.deferred || partial ? clock().toISOString() : nextDue();
    if (!store2.ledger.scheduleAgain(
      row2.scheduleId,
      row2.claimToken,
      nextDueAt,
      result.resumeAfter,
      // A deferred firing read nothing, so the row keeps its place in the order.
      swept.deferred ? null : startedAt2
    )) {
      log({ event: "sweepFailed", detail: `the claim on "${row2.scheduleId}" was lost` });
      return;
    }
    log({ event: "sweepFinished", scheduleId: row2.scheduleId, ...result, nextDueAt });
  };
  const fireDue = async () => {
    try {
      const now = clock().toISOString();
      const due = store2.ledger.claimDue(now);
      allowance.armMutations(writeCap);
      for (const row2 of due) {
        const repository = repositoryOfScheduleId(row2.scheduleId);
        if (row2.effect === SWEEP_EFFECT && repository !== null) {
          await fire(row2, repository);
          continue;
        }
        log({ event: "sweepFailed", detail: undrivable(row2) });
        store2.ledger.scheduleAgain(
          row2.scheduleId,
          row2.claimToken,
          nextDue(),
          row2.resumeAfter,
          null
        );
      }
    } catch (error) {
      log({ event: "sweepFailed", detail: detailOf2(error) });
    }
  };
  let firing = null;
  return {
    runDue() {
      firing ??= (async () => {
        try {
          await fireDue();
        } finally {
          firing = null;
        }
      })();
      return firing;
    },
    settled: () => firing ?? Promise.resolve()
  };
}

// src/shell/compose/live.ts
import { readFileSync } from "node:fs";

// src/adapter/client/jwt.ts
import { createSign } from "node:crypto";
var ASSERTION_BACKDATE_SECONDS = 60;
var ASSERTION_LIFETIME_SECONDS = 540;
var encode = (claims) => Buffer.from(JSON.stringify(claims)).toString("base64url");
function signAppAssertion(credentials, now) {
  const issuedAt = Math.floor(now.getTime() / 1e3) - ASSERTION_BACKDATE_SECONDS;
  const signingInput = [
    encode({ alg: "RS256", typ: "JWT" }),
    encode({
      iat: issuedAt,
      exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
      iss: credentials.appId
    })
  ].join(".");
  const signature = createSign("RSA-SHA256").update(signingInput).sign(credentials.privateKeyPem).toString("base64url");
  return `${signingInput}.${signature}`;
}

// src/adapter/client/contract.ts
var GITHUB_API_VERSION = "2026-03-10";
var GITHUB_API_ORIGIN = "https://api.github.com";
var GITHUB_GRAPHQL_URL = `${GITHUB_API_ORIGIN}/graphql`;
var DEFAULT_REQUEST_TIMEOUT_MS = 1e4;
var USER_AGENT = "hiero-hackers-sdk-automations";
function repoPath(repository) {
  return `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
}
function onOrigin(request, origin) {
  if (origin === GITHUB_API_ORIGIN) return request;
  if (typeof request.url !== "string" || !request.url.startsWith(`${GITHUB_API_ORIGIN}/`)) {
    return request;
  }
  return { ...request, url: origin + request.url.slice(GITHUB_API_ORIGIN.length) };
}
function headersToRecord(headers) {
  const record2 = {};
  headers.forEach((value, name) => {
    record2[name.toLowerCase()] = value;
  });
  return record2;
}
function lastPageFromLink(link) {
  if (link === void 0) return null;
  const match = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return match === null ? null : Number(match[1]);
}
function advertisesNextPage(link) {
  return link !== void 0 && link.includes('rel="next"');
}
function isWrite(request) {
  return "idempotency" in request;
}
function bodyOf(request) {
  if (!("body" in request)) return void 0;
  return typeof request.body === "string" ? request.body : void 0;
}
function transportFailure() {
  return { ok: false, failure: { kind: "transient" } };
}
function notSentFailure(reason) {
  return { ok: false, failure: { kind: "notSent", reason } };
}
function allowanceFailure(lane) {
  return { ok: false, failure: { kind: "notSent", reason: "allowanceExhausted", lane } };
}
function brokenSeamFailure(seam) {
  return { ok: false, failure: { kind: "notSent", reason: "brokenSeam", seam } };
}
function describeFailure(failure) {
  if (failure.kind === "responseTooLarge") {
    return `responseTooLarge (over ${String(failure.limitBytes)} bytes)`;
  }
  if (failure.kind !== "notSent") return failure.kind;
  if (failure.reason === "brokenSeam") return `notSent (broken seam: ${failure.seam})`;
  return failure.reason === "allowanceExhausted" ? `notSent (allowanceExhausted: ${failure.lane})` : `notSent (${failure.reason})`;
}

// src/adapter/client/untrusted.ts
function field(value, name) {
  if (typeof value !== "object" || value === null) return void 0;
  try {
    return Object.hasOwn(value, name) ? value[name] : void 0;
  } catch {
    return void 0;
  }
}
function jsonRecordOf(body) {
  let parsed2;
  try {
    parsed2 = JSON.parse(body);
  } catch {
    return null;
  }
  return typeof parsed2 === "object" && parsed2 !== null && !Array.isArray(parsed2) ? parsed2 : null;
}
function jsonArrayOf(body) {
  let parsed2;
  try {
    parsed2 = JSON.parse(body);
  } catch {
    return null;
  }
  return Array.isArray(parsed2) ? parsed2 : null;
}

// src/adapter/client/token.ts
function isWellFormedTokenOutcome(outcome) {
  if (typeof outcome !== "object" || outcome === null || typeof outcome.ok !== "boolean") {
    return false;
  }
  if (!outcome.ok) {
    return typeof outcome.failure === "object" && outcome.failure !== null && typeof outcome.failure.kind === "string";
  }
  const token = outcome.token;
  return typeof token === "object" && token !== null && typeof token.value === "string" && token.expiresAt instanceof Date && Number.isFinite(token.expiresAt.getTime()) && Array.isArray(token.grants);
}
var REFRESH_SKEW_SECONDS = 300;
var MINT_RETRY_COOLDOWN_SECONDS = 60;
function isPastExpiry(token, now) {
  return now.getTime() >= token.expiresAt.getTime();
}
function isDueForRefresh(token, now) {
  return now.getTime() + REFRESH_SKEW_SECONDS * 1e3 >= token.expiresAt.getTime();
}
var MINT_FLOOR_SECONDS = 60;
function grantsFromPermissions(permissions) {
  return Object.entries(permissions).map(([scope, level]) => `${scope}:${level}`).filter(isPermissionGrant);
}
function createTokenSource({ credentials, mint, clock }) {
  let cached = null;
  let pending = null;
  let retry = null;
  const withinMintFloor = (mintedAt, now) => now.getTime() - mintedAt.getTime() < MINT_FLOOR_SECONDS * 1e3;
  const retryPaused = (now) => retry !== null && now.getTime() < retry.notBefore.getTime();
  const mayServeHeldToken = (held2, mintedAt, now) => withinMintFloor(mintedAt, now) || !isPastExpiry(held2, now) && (!isDueForRefresh(held2, now) || retryPaused(now));
  const mintSafely = async () => {
    let assertion;
    try {
      assertion = signAppAssertion(credentials, clock());
    } catch {
      return { ok: false, failure: { kind: "badCredentials" } };
    }
    try {
      return await mint(assertion, credentials);
    } catch {
      return { ok: false, failure: { kind: "transient" } };
    }
  };
  const heldTokenOrFailure = (outcome) => {
    const now = clock();
    if (outcome.ok) return outcome;
    if (cached === null || isPastExpiry(cached.token, now)) {
      retry = {
        notBefore: new Date(now.getTime() + MINT_RETRY_COOLDOWN_SECONDS * 1e3),
        failure: outcome
      };
      return outcome;
    }
    retry = {
      notBefore: outcome.failure.kind === "secondaryLimit" ? cached.token.expiresAt : new Date(
        Math.min(
          cached.token.expiresAt.getTime(),
          now.getTime() + MINT_RETRY_COOLDOWN_SECONDS * 1e3
        )
      ),
      failure: outcome
    };
    return { ok: true, token: cached.token };
  };
  return {
    current() {
      const now = clock();
      if (cached !== null && mayServeHeldToken(cached.token, cached.mintedAt, now)) {
        return Promise.resolve({ ok: true, token: cached.token });
      }
      if (retry !== null && retryPaused(now)) {
        return Promise.resolve(retry.failure);
      }
      pending ??= mintSafely().then((outcome) => {
        if (outcome.ok) {
          cached = { token: outcome.token, mintedAt: clock() };
          retry = null;
        }
        return heldTokenOrFailure(outcome);
      }).finally(() => {
        pending = null;
      });
      return pending;
    },
    invalidate(token) {
      if (cached?.token.value === token.value) {
        cached = null;
        retry = null;
      }
    }
  };
}
function staticTokenSource({ value, grants, expiresAt }) {
  let closed = false;
  return {
    current() {
      if (closed) return Promise.resolve({ ok: false, failure: { kind: "badCredentials" } });
      return Promise.resolve({ ok: true, token: { value, expiresAt, grants } });
    },
    invalidate(token) {
      if (token.value === value) closed = true;
    }
  };
}

// src/adapter/client/mint.ts
var unreadableMint = { ok: false, failure: { kind: "transient" } };
function mintedTokenOf(body) {
  const record2 = jsonRecordOf(body);
  if (record2 === null) return null;
  const value = field(record2, "token");
  const expiresAtRaw = field(record2, "expires_at");
  if (typeof value !== "string" || typeof expiresAtRaw !== "string") return null;
  const expiresAt = new Date(expiresAtRaw);
  if (!Number.isFinite(expiresAt.getTime())) return null;
  const permissions = field(record2, "permissions");
  return {
    value,
    expiresAt,
    grants: grantsFromPermissions(
      typeof permissions === "object" && permissions !== null ? permissions : {}
    )
  };
}
function githubMintInstallationToken(options = {}) {
  const {
    fetch: send = fetch,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    timeoutSignal = AbortSignal.timeout,
    apiOrigin = GITHUB_API_ORIGIN
  } = options;
  return async (assertion, credentials) => {
    const url = `${apiOrigin}/app/installations/${credentials.installationId}/access_tokens`;
    let response;
    try {
      response = await send(url, {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${assertion}`,
          "user-agent": USER_AGENT,
          "x-github-api-version": GITHUB_API_VERSION
        },
        redirect: "manual",
        signal: timeoutSignal(timeoutMs)
      });
    } catch {
      return { ok: false, failure: { kind: "transient" } };
    }
    let body;
    try {
      body = await response.text();
    } catch {
      return unreadableMint;
    }
    if (!response.ok) {
      return {
        ok: false,
        failure: classifyFailure({
          status: response.status,
          body,
          headers: headersToRecord(response.headers),
          // A mint carries no token whose age could explain a 401.
          tokenPastExpiry: false
        })
      };
    }
    const token = mintedTokenOf(body);
    return token === null ? unreadableMint : { ok: true, token };
  };
}

// src/adapter/reads/config.ts
import { Buffer as Buffer2 } from "node:buffer";
var BLOB_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function decodeContents(body) {
  const response = jsonRecordOf(body);
  const sha = field(response, "sha");
  if (response === null || typeof sha !== "string" || !BLOB_SHA.test(sha)) {
    return { kind: "unrecognized" };
  }
  const type = field(response, "type");
  if (type !== "file") {
    return {
      kind: "defective",
      detail: `the config path is not a file (type ${String(type)})`,
      revision: `git:${sha}`
    };
  }
  const content = field(response, "content");
  if (field(response, "encoding") !== "base64" || typeof content !== "string") {
    return {
      kind: "defective",
      detail: "the config file's content is not retrievable inline (too large?)",
      revision: `git:${sha}`
    };
  }
  const encoded = content.replace(/[\r\n]/g, "");
  try {
    const bytes = Buffer2.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) {
      return {
        kind: "defective",
        detail: "the config file's content is not valid base64",
        revision: `git:${sha}`
      };
    }
    const text3 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { kind: "document", revision: revisionOf(text3), text: text3 };
  } catch {
    return {
      kind: "defective",
      detail: "the config file is not valid UTF-8",
      revision: `git:${sha}`
    };
  }
}
function githubConfigSource({
  client,
  repository,
  allowance
}) {
  const repoUrl = repoPath(repository);
  const configUrl = `${repoUrl}/contents/${CONFIG_PATH}`;
  const corroboratedAbsence = async () => {
    const repo = await client.request({ method: "GET", url: repoUrl }, allowance);
    if (repo.ok) {
      return { ok: true, document: { revision: ABSENT_CONFIG_REVISION, text: "" } };
    }
    return {
      ok: false,
      permanent: false,
      detail: "config 404 without a visible repository \u2014 access, not absence"
    };
  };
  return {
    async load() {
      const outcome = await client.request({ method: "GET", url: configUrl }, allowance);
      if (!outcome.ok) {
        return outcome.failure.kind === "notFoundOrNotInstalled" ? corroboratedAbsence() : {
          ok: false,
          permanent: false,
          detail: `config read failed: ${outcome.failure.kind}`
        };
      }
      const decoded = decodeContents(outcome.body);
      switch (decoded.kind) {
        case "document":
          return {
            ok: true,
            document: { revision: decoded.revision, text: decoded.text }
          };
        case "defective":
          return {
            ok: false,
            permanent: true,
            detail: decoded.detail,
            revision: decoded.revision
          };
        case "unrecognized":
          return {
            ok: false,
            permanent: false,
            detail: "unrecognized contents response shape"
          };
      }
    }
  };
}

// src/adapter/reads/failures.ts
var QUOTED_HEADER_LIMIT = 40;
var unavailable = (detail) => ({
  ok: false,
  reason: "unavailable",
  detail
});
var rateLimited = (detail) => ({
  ok: false,
  reason: "rateLimited",
  detail
});
function laneSpent(lane, allowance) {
  const window = allowance?.standing().find((pool) => pool.pool === lane)?.resetAt ?? null;
  return unavailable(
    `this lane's ${lane} allowance is spent; the pool resets at ` + (window ?? "an instant GitHub has not reported")
  );
}
function httpFailure(outcome, allowance) {
  const failure = outcome.failure;
  if (failure.kind === "notSent" && failure.reason === "allowanceExhausted") {
    return laneSpent(failure.lane, allowance);
  }
  switch (failure.kind) {
    case "permissionMissing":
      return { ok: false, reason: "noPermission", detail: "GitHub denied the query" };
    case "primaryExhausted":
      return rateLimited(
        "GitHub primary rate limit reached; the budget resets at " + (failure.resetAt ?? "an instant GitHub did not report")
      );
    case "secondaryLimit":
      return rateLimited(
        failure.retryAfterSeconds === void 0 ? "GitHub secondary rate limit reached, with no retry-after to wait on" : `GitHub secondary rate limit reached; retry-after ${String(failure.retryAfterSeconds)}s`
      );
    case "rateLimitResponseUnusable":
      return rateLimited(
        `GitHub rate limit reached; ${failure.headerName} "${failure.headerValue.slice(0, QUOTED_HEADER_LIMIT)}" is ${failure.reason}`
      );
    default:
      return unavailable(`GitHub query failed: ${describeFailure(failure)}`);
  }
}
function graphqlFailure(response, errors) {
  const types = errors.map((error) => field(error, "type"));
  if (response.headers["x-ratelimit-remaining"] === "0" || response.headers["retry-after"] !== void 0 || types.includes("RATE_LIMITED")) {
    return { ok: false, reason: "rateLimited", detail: "GitHub GraphQL rate limit reached" };
  }
  if (types.includes("FORBIDDEN")) {
    return { ok: false, reason: "noPermission", detail: "GitHub denied the GraphQL query" };
  }
  return unavailable("GitHub GraphQL returned errors");
}

// src/adapter/reads/links.ts
var LINKED_ISSUES_QUERY = `query LinkedIssues(
  $owner: String!
  $repo: String!
  $number: Int!
  $after: String
) {
  rateLimit { cost }
  repository(owner: $owner, name: $repo) {
    nameWithOwner
    pullRequest(number: $number) {
      number
      closingIssuesReferences(first: 100, after: $after, excludeUserLinked: true) {
        nodes { number repository { nameWithOwner } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;
var MAX_LINKED_ISSUE_PAGES = 10;
var BATCH_CONNECTION = "closingIssuesReferences(first: 100, excludeUserLinked: true) { nodes { number repository { nameWithOwner } } pageInfo { hasNextPage endCursor } }";
var MAX_BATCH_ALIASES = 100;
var aliasOf = (index) => `p${String(index)}`;
var variableOf = (index) => `n${String(index)}`;
function batchQuery(count2) {
  const spelled3 = Array.from({ length: count2 }, (_, index) => index);
  const declared = spelled3.map((index) => `$${variableOf(index)}: Int!`).join(", ");
  const aliased = spelled3.map(
    (index) => `${aliasOf(index)}: pullRequest(number: $${variableOf(index)}) { number ${BATCH_CONNECTION} }`
  ).join(" ");
  return `query LinkedIssuesBatch($owner: String!, $repo: String!, ${declared}) { rateLimit { cost } repository(owner: $owner, name: $repo) { ${aliased} } }`;
}
var malformed3 = () => unavailable("GitHub returned malformed linked-issue data");
var expectedOf = (repository) => `${repository.owner}/${repository.repo}`.toLowerCase();
function envelopeFailure(response, root) {
  if (root === null) return malformed3();
  const errors = field(root, "errors");
  if (errors === void 0) return null;
  if (!Array.isArray(errors)) return unavailable("GitHub returned malformed GraphQL errors");
  return errors.length > 0 ? graphqlFailure(response, errors) : null;
}
function pageOf(connection, expected) {
  const nodes = field(connection, "nodes");
  const pageInfo = field(connection, "pageInfo");
  const hasNextPage = field(pageInfo, "hasNextPage");
  const endCursor = field(pageInfo, "endCursor");
  if (!Array.isArray(nodes) || typeof hasNextPage !== "boolean" || endCursor !== null && typeof endCursor !== "string") {
    return malformed3();
  }
  const issues = [];
  for (const node of nodes) {
    const issueNumber = field(node, "number");
    const nameWithOwner = field(field(node, "repository"), "nameWithOwner");
    if (typeof issueNumber !== "number" || !Number.isSafeInteger(issueNumber) || issueNumber < 1 || typeof nameWithOwner !== "string") {
      return malformed3();
    }
    if (nameWithOwner.toLowerCase() === expected) {
      issues.push({ kind: "issue", number: issueNumber });
    }
  }
  return { ok: true, page: { issues, hasNextPage, endCursor } };
}
function parsePage(response, repository, number) {
  const root = jsonRecordOf(response.body);
  const broken2 = envelopeFailure(response, root);
  if (broken2 !== null) return broken2;
  const returnedRepository = field(field(root, "data"), "repository");
  const nameWithOwner = field(returnedRepository, "nameWithOwner");
  const pullRequest = field(returnedRepository, "pullRequest");
  if (typeof nameWithOwner !== "string" || nameWithOwner.toLowerCase() !== expectedOf(repository) || field(pullRequest, "number") !== number) {
    return malformed3();
  }
  const parsed2 = pageOf(field(pullRequest, "closingIssuesReferences"), expectedOf(repository));
  if (!parsed2.ok) return parsed2;
  const { hasNextPage, endCursor } = parsed2.page;
  return hasNextPage && (endCursor === null || endCursor.length === 0) ? unavailable("GitHub returned a missing linked-issue cursor") : parsed2;
}
function parseBatch(response, repository, numbers) {
  const root = jsonRecordOf(response.body);
  const broken2 = envelopeFailure(response, root);
  if (broken2 !== null) return broken2;
  const returnedRepository = field(field(root, "data"), "repository");
  const expected = expectedOf(repository);
  const pages = /* @__PURE__ */ new Map();
  for (const [index, number] of numbers.entries()) {
    const pullRequest = field(returnedRepository, aliasOf(index));
    if (field(pullRequest, "number") !== number) return malformed3();
    const parsed2 = pageOf(field(pullRequest, "closingIssuesReferences"), expected);
    if (!parsed2.ok) return parsed2;
    pages.set(number, parsed2.page);
  }
  return { ok: true, pages };
}
async function readLinkedIssues({ http, repository, allowance }, number) {
  const issues = [];
  const cursors = /* @__PURE__ */ new Set();
  let after = null;
  for (let page = 1; page <= MAX_LINKED_ISSUE_PAGES; page += 1) {
    const outcome = await http.request(
      {
        url: GITHUB_GRAPHQL_URL,
        method: "POST",
        body: JSON.stringify({
          operationName: "LinkedIssues",
          query: LINKED_ISSUES_QUERY,
          variables: { owner: repository.owner, repo: repository.repo, number, after }
        })
      },
      allowance
    );
    if (!outcome.ok) return httpFailure(outcome, allowance);
    const parsed2 = parsePage(outcome, repository, number);
    if (!parsed2.ok) return parsed2;
    issues.push(...parsed2.page.issues);
    const next = parsed2.page.hasNextPage ? parsed2.page.endCursor : null;
    if (next === null) return { ok: true, value: issues };
    if (cursors.has(next)) return unavailable("GitHub repeated a linked-issue cursor");
    cursors.add(next);
    after = next;
  }
  return unavailable("GitHub linked-issue pagination exceeded 10 pages");
}
async function readLinkedIssuesBatch(context, numbers) {
  const { http, repository, allowance } = context;
  const answered = /* @__PURE__ */ new Map();
  const heldBack2 = [];
  for (let sent = 0; sent < numbers.length; sent += MAX_BATCH_ALIASES) {
    const chunk = numbers.slice(sent, sent + MAX_BATCH_ALIASES);
    const variables = {
      owner: repository.owner,
      repo: repository.repo
    };
    for (const [index, number] of chunk.entries()) variables[variableOf(index)] = number;
    const outcome = await http.request(
      {
        url: GITHUB_GRAPHQL_URL,
        method: "POST",
        body: JSON.stringify({
          operationName: "LinkedIssuesBatch",
          query: batchQuery(chunk.length),
          variables
        })
      },
      allowance
    );
    if (!outcome.ok) return httpFailure(outcome, allowance);
    const parsed2 = parseBatch(outcome, repository, chunk);
    if (!parsed2.ok) return parsed2;
    for (const [number, page] of parsed2.pages) {
      answered.set(number, page.issues);
      if (page.hasNextPage) heldBack2.push(number);
    }
  }
  for (const number of heldBack2) {
    const whole = await readLinkedIssues(context, number);
    if (!whole.ok) return whole;
    answered.set(number, whole.value);
  }
  return { ok: true, value: answered };
}

// src/adapter/reads/resolvers.ts
var CONFIRMED_RESOLVER_READS = [
  // GraphQL `closingIssuesReferences` — Issues R — `2026-08-29T20-51-00.386Z#same-repository`
  "linkedIssues",
  // No call: GitHub gives every App actor the `[bot]` suffix.
  "isAutomationActor",
  // `GET /repos/{o}/{r}/pulls/{n}` — Pull requests R — `2026-07-23T19-41-18-911Z#3`
  "mergeability",
  // `GET /repos/{o}/{r}/issues` — Issues R — `2026-07-23T19-36-29-346Z#1–6`
  "openAssignments",
  // files, pull, contents (with `ref`) — Pull requests R, Contents R — `2026-07-23T20-16-41-190Z#7`, `2026-07-23T19-41-18-911Z#3`, `2026-07-23T19-09-37-225Z#2`
  "configAtHead",
  // `GET /repos/{o}/{r}/pulls/{n}/commits` — Pull requests R — `2026-09-12T06-31-36-229Z#23`
  "commitAttestations",
  // `GET /repos/{o}/{r}/issues/{n}` — Issues R — `2026-09-12T06-31-36-229Z#27`
  "assigneesOf"
];
function isConfirmedRead(query) {
  return CONFIRMED_RESOLVER_READS.includes(query);
}
var PAGE_SIZE = 100;
var MAX_LIST_PAGES = 10;
function itemNumber(input, kind) {
  const item = field(input, "item");
  const number = field(item, "number");
  return field(item, "kind") === kind && typeof number === "number" && Number.isSafeInteger(number) && number >= 1 ? number : null;
}
async function linkedIssues2(options, input) {
  const number = itemNumber(input, "pullRequest");
  return number === null ? unavailable("linkedIssues requires a valid pull request item") : readLinkedIssues(options, number);
}
var MAX_COMMITS = 250;
var MAX_COMMIT_PAGES = Math.ceil(MAX_COMMITS / PAGE_SIZE);
function hasSignoff(message) {
  return message.split("\n").some((line2) => /^\s*Signed-off-by:\s*\S/i.test(line2));
}
function attestationOf(entry) {
  const sha = field(entry, "sha");
  const commit = field(entry, "commit");
  const message = field(commit, "message");
  const parents = field(entry, "parents");
  if (typeof sha !== "string" || sha.length === 0 || typeof message !== "string") return null;
  if (!Array.isArray(parents)) return null;
  return {
    sha,
    // The subject line alone; no check reads the body.
    summary: message.split("\n")[0] ?? "",
    signedOff: hasSignoff(message),
    verified: field(field(commit, "verification"), "verified") === true,
    merge: parents.length > 1
  };
}
async function readCommitAttestations({ http, repository, allowance }, number) {
  const base = `${repoPath(repository)}/pulls/${String(number)}/commits`;
  const commits = [];
  for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
    const outcome = await http.request(
      {
        url: `${base}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`,
        method: "GET"
      },
      allowance
    );
    if (!outcome.ok) return httpFailure(outcome, allowance);
    const entries = jsonArrayOf(outcome.body);
    if (entries === null) return unavailable("GitHub returned malformed commit data");
    for (const entry of entries) {
      const attestation = attestationOf(entry);
      if (attestation === null) return unavailable("GitHub returned malformed commit data");
      commits.push(attestation);
    }
    if (entries.length < PAGE_SIZE) break;
  }
  return commits.length >= MAX_COMMITS ? unavailable(
    `GitHub lists at most ${String(MAX_COMMITS)} commits per pull request, and this one reached that limit`
  ) : { ok: true, value: commits };
}
async function commitAttestations(options, input) {
  const number = itemNumber(input, "pullRequest");
  return number === null ? unavailable("commitAttestations requires a valid pull request item") : readCommitAttestations(options, number);
}
async function mergeability({ http, repository, allowance }, input) {
  const number = itemNumber(input, "pullRequest");
  if (number === null) return unavailable("mergeability requires a valid pull request item");
  const outcome = await http.request(
    { url: `${repoPath(repository)}/pulls/${String(number)}`, method: "GET" },
    allowance
  );
  if (!outcome.ok) return httpFailure(outcome, allowance);
  const body = jsonRecordOf(outcome.body);
  if (body === null) return unavailable("GitHub returned malformed pull request data");
  if (body["number"] !== number) {
    return unavailable("GitHub answered about a different pull request");
  }
  const mergeable = body["mergeable"];
  if (typeof mergeable !== "boolean") {
    return unavailable("GitHub has not finished computing whether this branch merges cleanly");
  }
  return { ok: true, value: mergeable };
}
async function readAssigneesOf({ http, repository, allowance }, number) {
  const outcome = await http.request(
    { url: `${repoPath(repository)}/issues/${String(number)}`, method: "GET" },
    allowance
  );
  if (!outcome.ok) return httpFailure(outcome, allowance);
  const body = jsonRecordOf(outcome.body);
  if (body === null) return unavailable("GitHub returned malformed issue data");
  if (body["number"] !== number) return unavailable("GitHub answered about a different issue");
  const assignees3 = body["assignees"];
  if (!Array.isArray(assignees3)) return unavailable("GitHub returned malformed issue data");
  const logins = [];
  for (const assignee of assignees3) {
    const login = field(assignee, "login");
    if (typeof login !== "string" || login.length === 0) {
      return unavailable("GitHub returned malformed issue data");
    }
    logins.push(login);
  }
  return { ok: true, value: logins };
}
async function assigneesOf2(options, input) {
  const number = itemNumber(input, "issue");
  return number === null ? unavailable("assigneesOf requires a valid issue item") : readAssigneesOf(options, number);
}
async function assignedPages({ http, repository, allowance }, login) {
  const url = `${repoPath(repository)}/issues`;
  const entries = [];
  let lastPage = 1;
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const outcome = await http.request(
      {
        url: `${url}?per_page=${String(PAGE_SIZE)}&page=${String(page)}&state=open&assignee=${encodeURIComponent(login)}`,
        method: "GET"
      },
      allowance
    );
    if (!outcome.ok) return httpFailure(outcome, allowance);
    const read = jsonArrayOf(outcome.body);
    if (read === null) return unavailable("GitHub returned malformed assignment data");
    entries.push(...read);
    const link = outcome.headers["link"];
    if (page === 1) lastPage = lastPageFromLink(link) ?? lastPage;
    if (page >= lastPage && !advertisesNextPage(link)) return { ok: true, entries };
  }
  return unavailable(`GitHub assignment pagination exceeded ${String(MAX_LIST_PAGES)} pages`);
}
async function openAssignments(options, input) {
  const login = field(input, "login");
  if (typeof login !== "string" || login.length === 0) {
    return unavailable("openAssignments requires a valid login");
  }
  const listed2 = await assignedPages(options, login);
  if (!listed2.ok) return listed2;
  const wanted = login.toLowerCase();
  const assignments = [];
  for (const entry of listed2.entries) {
    const number = field(entry, "number");
    const labels = field(entry, "labels");
    const assignees3 = field(entry, "assignees");
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || !Array.isArray(labels) || !Array.isArray(assignees3)) {
      return unavailable("GitHub returned malformed assignment data");
    }
    if (field(entry, "pull_request") !== void 0) continue;
    const names = [];
    for (const label of labels) {
      const name = field(label, "name");
      if (typeof name !== "string") {
        return unavailable("GitHub returned malformed assignment data");
      }
      names.push(name);
    }
    const holders = [];
    for (const assignee of assignees3) {
      const each3 = field(assignee, "login");
      if (typeof each3 !== "string") {
        return unavailable("GitHub returned malformed assignment data");
      }
      holders.push(each3.toLowerCase());
    }
    if (!holders.includes(wanted)) continue;
    assignments.push({
      item: { kind: "issue", number },
      meanings: meaningsOfLabels(options.config, names)
    });
  }
  return { ok: true, value: assignments };
}
var COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
async function configFileChange({ http, repository, allowance }, number) {
  const url = `${repoPath(repository)}/pulls/${String(number)}/files`;
  let lastPage = 1;
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const outcome = await http.request(
      {
        url: `${url}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`,
        method: "GET"
      },
      allowance
    );
    if (!outcome.ok) return httpFailure(outcome, allowance);
    const entries = jsonArrayOf(outcome.body);
    if (entries === null) return unavailable("GitHub returned malformed pull request files");
    for (const entry of entries) {
      const filename = field(entry, "filename");
      const status = field(entry, "status");
      const previous = field(entry, "previous_filename");
      if (typeof filename !== "string" || typeof status !== "string") {
        return unavailable("GitHub returned malformed pull request files");
      }
      if (filename === CONFIG_PATH) return { ok: true, status };
      if (previous === CONFIG_PATH) return { ok: true, status: "removed" };
    }
    const link = outcome.headers["link"];
    if (page === 1) lastPage = lastPageFromLink(link) ?? lastPage;
    if (page >= lastPage && !advertisesNextPage(link)) return { ok: true, status: null };
  }
  return unavailable(`GitHub pull request files exceeded ${String(MAX_LIST_PAGES)} pages`);
}
async function headShaOf({ http, repository, allowance }, number) {
  const outcome = await http.request(
    { url: `${repoPath(repository)}/pulls/${String(number)}`, method: "GET" },
    allowance
  );
  if (!outcome.ok) return httpFailure(outcome, allowance);
  const body = jsonRecordOf(outcome.body);
  if (body === null) return unavailable("GitHub returned malformed pull request data");
  if (body["number"] !== number)
    return unavailable("GitHub answered about a different pull request");
  const sha = field(field(body, "head"), "sha");
  return typeof sha === "string" && COMMIT_SHA.test(sha) ? { ok: true, sha } : unavailable("GitHub reported no usable head commit for this pull request");
}
async function configAtHead(options, input) {
  const { http, repository, knownCapabilities, allowance } = options;
  const number = itemNumber(input, "pullRequest");
  if (number === null) return unavailable("configAtHead requires a valid pull request item");
  const change = await configFileChange(options, number);
  if (!change.ok) return change;
  if (change.status === null) return { ok: true, value: { touched: false } };
  if (change.status === "removed") {
    return {
      ok: true,
      value: {
        touched: true,
        revision: ABSENT_CONFIG_REVISION,
        // The parser's own no-file answer, so a deleted and an absent file agree by construction.
        result: parseConfig(null, {
          revision: ABSENT_CONFIG_REVISION,
          knownCapabilities
        })
      }
    };
  }
  const head = await headShaOf(options, number);
  if (!head.ok) return head;
  const outcome = await http.request(
    {
      url: `${repoPath(repository)}/contents/${CONFIG_PATH}?ref=${encodeURIComponent(head.sha)}`,
      method: "GET"
    },
    allowance
  );
  if (!outcome.ok) return httpFailure(outcome, allowance);
  const decoded = decodeContents(outcome.body);
  if (decoded.kind !== "document") {
    return unavailable(
      decoded.kind === "defective" ? `the proposed config file is unreadable: ${decoded.detail}` : "GitHub returned an unrecognized contents response"
    );
  }
  return {
    ok: true,
    value: {
      touched: true,
      revision: decoded.revision,
      result: parseConfigDocument(decoded.text, {
        revision: decoded.revision,
        knownCapabilities
      })
    }
  };
}
function isAutomationActor(input) {
  const login = field(input, "login");
  return typeof login === "string" && login.length > 0 ? { ok: true, value: isAutomationLogin(login) } : unavailable("isAutomationActor requires a valid login");
}
function createResolverSource(options) {
  const resolve = async (query, input) => {
    if (!isConfirmedRead(query)) {
      return unavailable(
        `"${query}" reads an endpoint the permission matrix has not confirmed`
      );
    }
    switch (query) {
      case "linkedIssues":
        return linkedIssues2(options, input);
      case "isAutomationActor":
        return isAutomationActor(input);
      case "mergeability":
        return mergeability(options, input);
      case "openAssignments":
        return openAssignments(options, input);
      case "configAtHead":
        return configAtHead(options, input);
      case "commitAttestations":
        return commitAttestations(options, input);
      case "assigneesOf":
        return assigneesOf2(options, input);
    }
  };
  return resolve;
}

// src/adapter/reads/groups/assignees.ts
var assignees2 = {
  reads: ["assignedAt", "lastWorkingAt"],
  read: {
    issue: ({ listed: listed2, clocksFor }) => clocksFor(listed2.item, listed2.assignees),
    pullRequest: ({ listed: listed2, clocksFor }) => clocksFor(listed2.item, listed2.assignees)
  }
};

// src/adapter/reads/items.ts
var CONFIRMED_SWEEP_READS = [
  // `GET /repos/{o}/{r}/issues` — Issues R — `2026-07-23T19-36-29-346Z#1–6`
  "openItems",
  // the item timeline's `assigned` events — Issues R — `2026-07-23T19-38-17-272Z#13`
  "assignedAt",
  // `GET /repos/{o}/{r}/issues/{n}/comments` — Issues R — `2026-07-23T19-41-18-911Z#2`
  "lastWorkingAt",
  // `GET /repos/{o}/{r}/pulls/{n}` — Pull requests R — `2026-07-23T19-41-18-911Z#3`
  "draft",
  // GraphQL `closingIssuesReferences` — Issues R + Pull requests R — `2026-08-29T20-51-00.386Z#same-repository`
  "linkedIssues",
  // `GET /repos/{o}/{r}/pulls/{n}/reviews` — Pull requests R — `2026-09-12T06-31-36-229Z#10` (D156)
  "changesRequested",
  // the item timeline on a PULL REQUEST number — Pull requests R — `2026-09-12T06-31-36-229Z#15`
  "reapableSince",
  // `GET /repos/{o}/{r}/pulls/{n}/commits` — Pull requests R — `2026-09-12T06-31-36-229Z#19`
  "lastCommitAt",
  // the same query, aliased a hundred times — Issues R + Pull requests R — `2026-09-15T16-34-56-751Z#17`
  "linkedIssuesBatch"
];
function isConfirmed(read) {
  return CONFIRMED_SWEEP_READS.includes(read);
}
var PAGE_SIZE2 = 100;
var MAX_PAGES = 10;
var unreadable = (detail) => ({ ok: false, detail });
async function allPages(reads, pageUrl, what) {
  const entries = [];
  let lastPage = 1;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const at2 = `${what} page ${String(page)}`;
    const outcome = await reads.http.request(
      { url: pageUrl(page), method: "GET" },
      reads.allowance
    );
    if (!outcome.ok) return unreadable(`${at2}: ${describeFailure(outcome.failure)}`);
    const read = jsonArrayOf(outcome.body);
    if (read === null) return unreadable(`${at2}: the body was not a JSON array`);
    entries.push(...read);
    const link = outcome.headers["link"];
    if (page === 1) lastPage = lastPageFromLink(link) ?? lastPage;
    if (page >= lastPage && !advertisesNextPage(link)) return { ok: true, value: entries };
  }
  return unreadable(`${what}: the list is longer than ${String(MAX_PAGES)} pages`);
}
async function readRecord(reads, url, what) {
  const outcome = await reads.http.request({ url, method: "GET" }, reads.allowance);
  if (!outcome.ok) return unreadable(`${what}: ${describeFailure(outcome.failure)}`);
  const record2 = jsonRecordOf(outcome.body);
  return record2 === null ? unreadable(`${what}: the body was not a JSON object`) : { ok: true, value: record2 };
}
function instant(value) {
  if (typeof value !== "string") return null;
  const at2 = new Date(value);
  return Number.isFinite(at2.getTime()) ? at2 : null;
}
function newer(held2, seen) {
  return held2 === void 0 || seen.getTime() > held2.getTime() ? seen : held2;
}
var issuePath = ({ repository }, number) => `${repoPath(repository)}/issues/${String(number)}`;
var pullPath = ({ repository }, number) => `${repoPath(repository)}/pulls/${String(number)}`;
var paged = (url, page) => `${url}?per_page=${String(PAGE_SIZE2)}&page=${String(page)}`;
var readTimeline = (context, number) => allPages(
  context,
  (page) => paged(`${issuePath(context, number)}/timeline`, page),
  `#${String(number)} timeline`
);
var readPull = (context, number) => readRecord(context, pullPath(context, number), `#${String(number)} pull request`);
var everyTime = (context) => ({
  timelineFor: (number) => readTimeline(context, number),
  pullFor: (number) => readPull(context, number)
});
async function readOpenItems(context) {
  const url = `${repoPath(context.repository)}/issues`;
  const read = await allPages(
    context,
    (page) => `${paged(url, page)}&state=open`,
    "the open-item list"
  );
  if (!read.ok) return read;
  const items = [];
  for (const entry of read.value) {
    const number = field(entry, "number");
    const state = field(entry, "state");
    const updatedAt = instant(field(entry, "updated_at"));
    const labels = labelNamesOf(field(entry, "labels"));
    const assignees3 = loginsOf(field(entry, "assignees"));
    const author = field(field(entry, "user"), "login");
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || state !== "open" && state !== "closed" || updatedAt === null || labels === null || assignees3 === null || typeof author !== "string" || author.length === 0) {
      return { ok: false, detail: "the open-item list carried an unreadable item" };
    }
    items.push({
      item: {
        kind: field(entry, "pull_request") === void 0 ? "issue" : "pullRequest",
        number
      },
      author,
      labels,
      assignees: assignees3,
      closedBy: state === "closed" ? "closedByHuman" : null,
      updatedAt,
      entry
    });
  }
  return { ok: true, items };
}
function labelNamesOf(labels) {
  if (!Array.isArray(labels)) return null;
  const names = [];
  for (const label of labels) {
    const name = field(label, "name");
    if (typeof name !== "string") return null;
    names.push(name);
  }
  return names;
}
function loginsOf(assignees3) {
  if (!Array.isArray(assignees3)) return null;
  const logins = [];
  for (const assignee of assignees3) {
    const login = field(assignee, "login");
    if (typeof login !== "string" || login.length === 0) return null;
    logins.push(login);
  }
  return logins;
}
async function readAssignedAt(context, number, walk = everyTime(context)) {
  const read = await walk.timelineFor(number);
  if (!read.ok) return read;
  const assigned = /* @__PURE__ */ new Map();
  for (const entry of read.value) {
    if (field(entry, "event") !== "assigned") continue;
    const login = field(field(entry, "assignee"), "login");
    const at2 = instant(field(entry, "created_at"));
    if (typeof login !== "string" || at2 === null) {
      return unreadable(`#${String(number)} timeline: an assigned event was unreadable`);
    }
    assigned.set(login, newer(assigned.get(login), at2));
  }
  return { ok: true, value: assigned };
}
function firstToken(body) {
  if (typeof body !== "string") return null;
  const trimmed = body.trim();
  if (trimmed.length === 0) return "";
  return trimmed.split(/\s+/u)[0].toLowerCase();
}
async function readLastWorkingAt(context, number, spelling) {
  const read = await allPages(
    context,
    (page) => paged(`${issuePath(context, number)}/comments`, page),
    `#${String(number)} comments`
  );
  if (!read.ok) return read;
  const wanted = spelling.trim().toLowerCase();
  const working = /* @__PURE__ */ new Map();
  for (const entry of read.value) {
    const login = field(field(entry, "user"), "login");
    const at2 = instant(field(entry, "created_at"));
    const token = firstToken(field(entry, "body"));
    if (typeof login !== "string" || at2 === null || token === null) {
      return unreadable(`#${String(number)} comments: a comment was unreadable`);
    }
    if (token !== wanted) continue;
    working.set(login, newer(working.get(login), at2));
  }
  return { ok: true, value: working };
}
async function readDraft(context, number, walk = everyTime(context)) {
  const read = await walk.pullFor(number);
  if (!read.ok) return read;
  const draft = read.value["draft"];
  return typeof draft === "boolean" ? { ok: true, value: draft } : unreadable(`#${String(number)} pull request: draft was not a boolean`);
}
var DECIDING_REVIEW_STATES = /* @__PURE__ */ new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "DISMISSED"
]);
async function readChangesRequested(context, number) {
  const read = await allPages(
    context,
    (page) => paged(`${pullPath(context, number)}/reviews`, page),
    `#${String(number)} reviews`
  );
  if (!read.ok) return read;
  const latest = /* @__PURE__ */ new Map();
  for (const entry of read.value) {
    const state = field(entry, "state");
    const login = field(field(entry, "user"), "login");
    if (typeof state !== "string" || typeof login !== "string") {
      return unreadable(`#${String(number)} reviews: a review was unreadable`);
    }
    if (DECIDING_REVIEW_STATES.has(state)) latest.set(login, state);
  }
  return { ok: true, value: [...latest.values()].includes("CHANGES_REQUESTED") };
}
async function readReapableSince(context, number, walk = everyTime(context)) {
  const opened = await walk.pullFor(number);
  if (!opened.ok) return opened;
  const createdAt = instant(opened.value["created_at"]);
  if (createdAt === null) {
    return unreadable(`#${String(number)} pull request: created_at was unreadable`);
  }
  const read = await walk.timelineFor(number);
  if (!read.ok) return read;
  const entered = {
    needsRevision: createdAt,
    changesRequested: createdAt,
    draft: createdAt
  };
  const revisionLabel = context.config.mappings.labels.needsRevision;
  for (const entry of read.value) {
    const kind = field(entry, "event");
    const label = field(field(entry, "label"), "name");
    const reason = kind === "convert_to_draft" ? "draft" : kind === "reviewed" && field(entry, "state") === "changes_requested" ? "changesRequested" : kind === "labeled" && typeof label === "string" && revisionLabel !== void 0 && labelKey(label) === labelKey(revisionLabel) ? "needsRevision" : null;
    if (reason === null) continue;
    const at2 = instant(field(entry, "created_at") ?? field(entry, "submitted_at"));
    if (at2 === null) {
      return unreadable(`#${String(number)} timeline: a mode event was undated`);
    }
    entered[reason] = newer(entered[reason], at2);
  }
  return { ok: true, value: entered };
}
async function readLastCommitAt(context, number) {
  const read = await allPages(
    context,
    (page) => paged(`${pullPath(context, number)}/commits`, page),
    `#${String(number)} commits`
  );
  if (!read.ok) return read;
  let newest = null;
  for (const entry of read.value) {
    const committed = field(field(field(entry, "commit"), "committer"), "date");
    const at2 = instant(committed);
    if (at2 === null) return unreadable(`#${String(number)} commits: a commit was undated`);
    newest = newest === null ? at2 : newer(newest, at2);
  }
  return { ok: true, value: newest };
}
async function readPullRequestActivity(context, number, working) {
  const commit = await readLastCommitAt(context, number);
  if (!commit.ok) return commit;
  if (working === void 0) return commit;
  const comments = await readLastWorkingAt(context, number, working);
  if (!comments.ok) return comments;
  let newest = commit.value;
  for (const at2 of comments.value.values()) {
    if (newest === null || at2.getTime() > newest.getTime()) newest = at2;
  }
  return { ok: true, value: newest };
}
async function readReview(context, number, walk = everyTime(context)) {
  const changesRequested = await readChangesRequested(context, number);
  if (!changesRequested.ok) return changesRequested;
  const reapableSince = await readReapableSince(context, number, walk);
  if (!reapableSince.ok) return reapableSince;
  const lastCommitAt = await readLastCommitAt(context, number);
  if (!lastCommitAt.ok) return lastCommitAt;
  return {
    ok: true,
    value: {
      changesRequested: changesRequested.value,
      reapableSince: reapableSince.value,
      lastCommitAt: lastCommitAt.value
    }
  };
}

// src/adapter/reads/groups/command.ts
var command3 = {
  reads: [],
  read: {
    issue: () => Promise.resolve(unreadable("a sweep carries no comment"))
  }
};

// src/adapter/reads/groups/links.ts
var links2 = {
  reads: ["linkedIssuesBatch", "linkedIssues", "assignedAt", "lastWorkingAt"],
  read: {
    issue: ({ openPullRequests }) => Promise.resolve(
      openPullRequests === "unread" ? unreadable("the linked-issue read answered nothing") : { ok: true, value: { openPullRequests } }
    ),
    pullRequest: async ({ closes, openIssues, clocksFor }) => {
      if (closes === "unread") return unreadable("the linked-issue read answered nothing");
      const issues = [];
      for (const reference of closes) {
        const listed2 = openIssues.find((open) => open.item.number === reference.number);
        if (listed2 === void 0) continue;
        const read = await clocksFor(listed2.item, listed2.assignees);
        if (!read.ok) return read;
        issues.push({ item: listed2.item, assignees: read.value });
      }
      return { ok: true, value: { issues } };
    }
  }
};

// src/adapter/reads/groups/locked.ts
var locked2 = {
  reads: [],
  read: {
    issue: ({ listed: listed2 }) => {
      const value = field(listed2.entry, "locked");
      return Promise.resolve(
        typeof value === "boolean" ? { ok: true, value } : unreadable(`#${String(listed2.item.number)}: locked missing`)
      );
    }
  }
};

// src/adapter/reads/groups/readiness.ts
var readiness2 = {
  reads: ["draft"],
  read: {
    pullRequest: async ({ listed: listed2, context, walk }) => {
      const draft = await readDraft(context, listed2.item.number, walk);
      return draft.ok ? { ok: true, value: { draft: draft.value } } : draft;
    }
  }
};

// src/adapter/reads/groups/review.ts
var review2 = {
  reads: ["changesRequested", "reapableSince", "lastCommitAt"],
  read: {
    pullRequest: ({ listed: listed2, context, walk }) => readReview(context, listed2.item.number, walk)
  }
};

// src/adapter/reads/groups/skills.ts
var skills2 = {
  reads: [],
  read: {
    issue: ({ listed: listed2, context }) => Promise.resolve({ ok: true, value: skillsOfLabels(context.config, listed2.labels) })
  }
};

// src/adapter/reads/groups/index.ts
var SWEEP_GROUPS = {
  locked: locked2,
  skills: skills2,
  assignees: assignees2,
  links: links2,
  review: review2,
  readiness: readiness2,
  command: command3
};
var GROUP_READS = Object.fromEntries(
  Object.entries(SWEEP_GROUPS).map(([group, module]) => [group, module.reads])
);

// src/adapter/reads/facts.ts
function promised(kind, group) {
  return producerReads("sweep", kind, group);
}
function once(memo, key, start) {
  let pending = memo.get(key);
  if (pending === void 0) {
    pending = start();
    memo.set(key, pending);
  }
  return pending;
}
function createFactsReader(options) {
  const { config, clock } = options;
  const context = {
    http: options.http,
    repository: options.repository,
    config: options.config,
    ...options.allowance === void 0 ? {} : { allowance: options.allowance }
  };
  const working = config.mappings.commands.working;
  const clocks = /* @__PURE__ */ new Map();
  const timelines = /* @__PURE__ */ new Map();
  const pulls = /* @__PURE__ */ new Map();
  const walk = {
    timelineFor: (number) => once(timelines, number, () => readTimeline(context, number)),
    pullFor: (number) => once(pulls, number, () => readPull(context, number))
  };
  const needed = (kind, group) => promised(kind, group) && (GROUP_READS[group].length === 0 || options.groups[kind].includes(group));
  const groupOf2 = async (kind, group, read) => {
    if (!needed(kind, group)) return UNREAD;
    if (!GROUP_READS[group].every(isConfirmed)) return UNREAD;
    const answer = await read();
    return answer.ok ? answer.value : UNREAD;
  };
  const readClocks = async (number, logins) => {
    const assigned = await readAssignedAt(context, number, walk);
    if (!assigned.ok) return assigned;
    const worked = working === void 0 ? { ok: true, value: /* @__PURE__ */ new Map() } : await readLastWorkingAt(context, number, working);
    if (!worked.ok) return worked;
    const built = [];
    for (const login of logins) {
      const assignedAt = assigned.value.get(login);
      if (assignedAt === void 0) {
        return unreadable(`#${String(number)}: no assignment event for "${login}"`);
      }
      built.push({ login, assignedAt, lastWorkingAt: worked.value.get(login) ?? null });
    }
    return { ok: true, value: built };
  };
  const clocksFor = (item, logins) => once(clocks, item.number, () => readClocks(item.number, logins));
  const meanings2 = (listed2) => meaningsOfLabels(config, listed2.labels);
  const wantsLinks = () => (needed("issue", "links") || needed("pullRequest", "links")) && GROUP_READS.links.every(isConfirmed);
  const linksFor = async (numbers) => {
    const nobodyAnswered = () => new Map(numbers.map((number) => [number, UNREAD]));
    if (numbers.length === 0 || !wantsLinks()) return nobodyAnswered();
    const read = await readLinkedIssuesBatch(context, numbers);
    return read.ok ? read.value : nobodyAnswered();
  };
  const groupsOf = async (kind, scope, stored) => {
    const kept = keptOn(kind);
    const groups = {};
    for (const group of FACT_GROUPS) {
      if (!carriesFactGroup(kind, group)) continue;
      if (stored !== void 0 && kept.includes(group)) {
        groups[group] = stored[group];
        continue;
      }
      const read = SWEEP_GROUPS[group].read[kind];
      groups[group] = await groupOf2(kind, group, () => read(scope));
    }
    return groups;
  };
  const observed = (listed2) => ({
    repository: options.repository,
    item: listed2.item,
    observedAt: clock(),
    trigger: { kind: "sweep" },
    author: listed2.author,
    actor: null
  });
  const scopeOf = (listed2, openPullRequests, closes, openIssues) => ({ listed: listed2, context, walk, clocksFor, openPullRequests, closes, openIssues });
  return {
    openItems: () => readOpenItems(context),
    linksFor,
    async issueFacts(listed2, links3, stored) {
      const groups = await groupsOf("issue", scopeOf(listed2, links3, UNREAD, []), stored);
      return {
        kind: "issue",
        ...observed(listed2),
        arrival: null,
        position: projectIssue({ closedBy: listed2.closedBy, meanings: meanings2(listed2) }),
        ...groups
      };
    },
    async pullRequestFacts(listed2, openIssues, closes, stored) {
      const groups = await groupsOf(
        "pullRequest",
        scopeOf(listed2, UNREAD, closes, openIssues),
        stored
      );
      return {
        kind: "pullRequest",
        ...observed(listed2),
        position: projectPullRequest({
          closedBy: listed2.closedBy,
          meanings: meanings2(listed2)
        }),
        ...groups
      };
    }
  };
}

// src/adapter/reads/externals.ts
async function installationGrants(source) {
  const outcome = await source.current();
  return outcome.ok ? { ok: true, grants: outcome.token.grants } : { ok: false, failure: outcome.failure };
}
var HUMAN_CHANGE_EVENTS = /* @__PURE__ */ new Set([
  "labeled",
  "unlabeled",
  "assigned",
  "unassigned",
  "closed",
  "reopened",
  "commented",
  "committed",
  "convert_to_draft",
  "ready_for_review",
  "reviewed",
  "review_dismissed",
  "review_requested"
]);
var TIMELINE_READ_CAP = 3;
var TIMELINE_PAGE_SIZE = 100;
var OWN_WRITE_WINDOW_MS = 6e4;
var CREATION_LAG_SECONDS = 10;
var sameSecond = (a, b) => Math.floor(a.getTime() / 1e3) === Math.floor(b.getTime() / 1e3);
function changeTarget(entry, action) {
  if (action === "labeled" || action === "unlabeled") return field(field(entry, "label"), "name");
  if (action === "assigned" || action === "unassigned")
    return field(field(entry, "assignee"), "login");
  return null;
}
var RELEASE_VERBS = /* @__PURE__ */ new Set(["releaseAssignment", "unassign"]);
function releasedByApp(login, at2, landed2) {
  if (typeof login !== "string") return false;
  return landed2.some((write) => {
    if (!RELEASE_VERBS.has(write.verb ?? "") || write.login !== login) return false;
    const done = new Date(write.at).getTime();
    if (!Number.isFinite(done)) return false;
    const gap = done - at2.getTime();
    return gap >= 0 && gap <= OWN_WRITE_WINDOW_MS;
  });
}
function committedAt(entry) {
  const date = field(field(entry, "committer"), "date");
  if (typeof date !== "string") return "unparsable";
  const at2 = new Date(date);
  return Number.isFinite(at2.getTime()) ? at2 : "unparsable";
}
function humanChangeAt(entry, landed2) {
  const kind = field(entry, "event");
  if (typeof kind !== "string" || !HUMAN_CHANGE_EVENTS.has(kind)) return null;
  if (kind === "committed") return committedAt(entry);
  const reviewed = kind === "reviewed";
  const actor = field(entry, reviewed ? "user" : "actor");
  const actorType = field(actor, "type");
  if (actorType === "Bot") return null;
  if (actorType !== "User") return "unparsable";
  const createdAt = field(entry, reviewed ? "submitted_at" : "created_at");
  if (typeof createdAt !== "string") return "unparsable";
  const at2 = new Date(createdAt);
  if (!Number.isFinite(at2.getTime())) return "unparsable";
  if (kind === "unassigned" && releasedByApp(changeTarget(entry, kind), at2, landed2)) {
    return null;
  }
  return at2;
}
var secondOf2 = (date) => Math.floor(date.getTime() / 1e3);
function takeCreationEntry(entry, at2, cause, pending) {
  const lag = secondOf2(at2) - secondOf2(cause.observedAt);
  if (lag < 0 || lag > CREATION_LAG_SECONDS) return false;
  if (field(field(entry, "actor"), "login") !== cause.actorLogin) return false;
  const action = field(entry, "event");
  const index = pending.findIndex(
    (created) => created.action === action && changeTarget(entry, created.action) === created.target
  );
  if (index === -1) return false;
  pending.splice(index, 1);
  return true;
}
var shows = (labels, action, name) => labels.includes(name) === (action === "labeled");
function takeShownLabel(entry, at2, cause, taken) {
  if (cause.labels === void 0) return false;
  const action = field(entry, "event");
  if (action !== "labeled" && action !== "unlabeled") return false;
  if (field(field(entry, "actor"), "login") !== cause.actorLogin) return false;
  if (!sameSecond(at2, cause.observedAt)) return false;
  const name = changeTarget(entry, action);
  if (typeof name !== "string" || taken.has(name) || !shows(cause.labels, action, name))
    return false;
  taken.add(name);
  return true;
}
function newestIn(events, landed2, cause) {
  const pending = [...cause?.createdWith ?? []];
  const takenLabels = /* @__PURE__ */ new Set();
  let newest = null;
  for (const entry of events) {
    const at2 = humanChangeAt(entry, landed2);
    if (at2 === "unparsable") return "unknown";
    if (at2 === null) continue;
    if (cause !== void 0 && takeCreationEntry(entry, at2, cause, pending)) continue;
    if (cause !== void 0 && takeShownLabel(entry, at2, cause, takenLabels)) continue;
    if (cause !== void 0 && cause.labels === void 0 && field(entry, "event") === cause.action && field(field(entry, "actor"), "login") === cause.actorLogin && sameSecond(at2, cause.observedAt) && changeTarget(entry, cause.action) === cause.target) {
      cause = void 0;
      continue;
    }
    if (newest === null || at2.getTime() > newest.getTime()) newest = at2;
  }
  return newest;
}
function parsePage2(outcome) {
  if (!outcome.ok) {
    return { unreadable: `GitHub refused the read: ${describeFailure(outcome.failure)}` };
  }
  const events = jsonArrayOf(outcome.body);
  if (events === null) return { unreadable: "GitHub's timeline body was not a JSON array" };
  const link = outcome.headers.link;
  const lastPage = lastPageFromLink(link);
  if (lastPage === null && link?.includes('rel="next"')) {
    return { unreadable: "GitHub advertised a next page without naming the last" };
  }
  return { events, lastPage };
}
async function readOrdering({ http, repository, ownWrites, cause, onUnknownOrdering, allowance }, item) {
  const landed2 = ownWrites(item);
  const pageUrl = (page) => `${repoPath(repository)}/issues/${String(item.number)}/timeline?per_page=${String(TIMELINE_PAGE_SIZE)}&page=${String(page)}`;
  const read = async (page) => parsePage2(await http.request({ url: pageUrl(page), method: "GET" }, allowance));
  const unknown = (detail) => {
    try {
      onUnknownOrdering?.(`#${String(item.number)} ordering unknown: ${detail}`);
    } catch {
    }
    return "unknown";
  };
  const itemCause = cause?.itemNumber === item.number ? cause : void 0;
  const newestOf = (events) => {
    const answer = newestIn(events, landed2, itemCause);
    return answer === "unknown" ? unknown("a timeline entry carried an unreadable actor or timestamp") : answer;
  };
  const first = await read(1);
  if ("unreadable" in first) return unknown(`page 1: ${first.unreadable}`);
  const lastPage = first.lastPage ?? 1;
  if (lastPage === 1) return newestOf(first.events);
  const descending = [];
  for (let page = lastPage; page > 1 && descending.length < TIMELINE_READ_CAP - 1; page -= 1) {
    descending.push(page);
  }
  const recent = [];
  for (const page of descending) {
    const outcome = await read(page);
    if ("unreadable" in outcome) {
      return unknown(`page ${String(page)}: ${outcome.unreadable}`);
    }
    recent.push(...outcome.events);
    const newest = newestOf(recent);
    if (newest !== null) return newest;
  }
  return lastPage <= 1 + descending.length ? newestOf([...recent, ...first.events]) : unknown(`the timeline is longer than ${String(TIMELINE_READ_CAP)} reads may cover`);
}
function openingOf(item, login, itemNumber2) {
  const createdAt = field(item, "created_at");
  if (field(field(item, "user"), "login") !== login || typeof createdAt !== "string")
    return void 0;
  const observedAt = new Date(createdAt);
  if (!Number.isFinite(observedAt.getTime())) return void 0;
  const labels = labelNamesOf(field(item, "labels"));
  const assignees3 = loginsOf(field(item, "assignees"));
  if (labels === null || assignees3 === null) return void 0;
  const createdWith = [
    ...labels.map((target) => ({ action: "labeled", target })),
    ...assignees3.map((target) => ({ action: "assigned", target }))
  ];
  return createdWith.length === 0 ? void 0 : {
    actorLogin: login,
    observedAt,
    itemNumber: itemNumber2,
    action: "opened",
    target: null,
    createdWith
  };
}
function commentingOf(payload, itemNumber2) {
  const comment = field(payload, "comment");
  const login = field(field(comment, "user"), "login");
  const createdAt = field(comment, "created_at");
  if (typeof login !== "string" || typeof createdAt !== "string") return void 0;
  const observedAt = new Date(createdAt);
  if (!Number.isFinite(observedAt.getTime())) return void 0;
  return { actorLogin: login, observedAt, itemNumber: itemNumber2, action: "commented", target: null };
}
function labelsAfter(item, action, target) {
  if (action !== "labeled" && action !== "unlabeled" || target === null) return null;
  const labels = labelNamesOf(field(item, "labels"));
  return labels !== null && shows(labels, action, target) ? labels : null;
}
function causeFingerprintOf(payload) {
  const login = field(field(payload, "sender"), "login");
  const item = field(payload, "issue") ?? field(payload, "pull_request");
  const updatedAt = field(item, "updated_at");
  const itemNumber2 = field(item, "number");
  const action = field(payload, "action");
  if (typeof login !== "string" || typeof updatedAt !== "string") return void 0;
  if (typeof itemNumber2 !== "number" || !Number.isSafeInteger(itemNumber2) || itemNumber2 < 1)
    return void 0;
  if (action === "opened") return openingOf(item, login, itemNumber2);
  if (action === "created") return commentingOf(payload, itemNumber2);
  if (typeof action !== "string" || !HUMAN_CHANGE_EVENTS.has(action)) return void 0;
  const target = changeTarget(payload, action);
  if (target !== null && typeof target !== "string") return void 0;
  const observedAt = new Date(updatedAt);
  if (!Number.isFinite(observedAt.getTime())) return void 0;
  const labels = labelsAfter(item, action, target);
  return {
    actorLogin: login,
    observedAt,
    itemNumber: itemNumber2,
    action,
    target,
    ...labels === null ? {} : { labels }
  };
}
function orderingEvidenceSource(options) {
  const memo = /* @__PURE__ */ new Map();
  return (item) => {
    const key = `${item.kind}#${String(item.number)}`;
    let pending = memo.get(key);
    if (pending === void 0) {
      pending = readOrdering(options, item);
      memo.set(key, pending);
    }
    return pending;
  };
}
async function liveExternalsForDelivery({
  tokenSource,
  http,
  repository,
  config,
  knownCapabilities,
  allowance,
  ownWrites,
  onUnknownOrdering
}, payload) {
  const grants = await installationGrants(tokenSource);
  if (!grants.ok) return grants;
  const cause = causeFingerprintOf(payload);
  const charged = allowance === void 0 ? {} : { allowance };
  return {
    ok: true,
    facts: {
      installationGrants: grants.grants,
      latestHumanChangeAt: orderingEvidenceSource({
        http,
        repository,
        ownWrites,
        ...charged,
        // Stryker disable next-line ConditionalExpression: spreading { cause: undefined } is runtime-identical; the guard serves exactOptionalPropertyTypes.
        ...cause === void 0 ? {} : { cause },
        // Stryker disable next-line ConditionalExpression: as above — the guard serves exactOptionalPropertyTypes, not behaviour.
        ...onUnknownOrdering === void 0 ? {} : { onUnknownOrdering }
      }),
      resolve: createResolverSource({
        http,
        repository,
        config,
        knownCapabilities,
        ...charged
      })
    }
  };
}

// src/adapter/writes/requests.ts
function issuePath2(repository, item) {
  return `${repoPath(repository)}/issues/${String(item.number)}`;
}
function pullPath2(repository, item) {
  return `${repoPath(repository)}/pulls/${String(item.number)}`;
}
var REQUESTS = {
  createLabel: (repository, label, color, description) => ({
    request: {
      url: `${repoPath(repository)}/labels`,
      method: "POST",
      body: JSON.stringify({ name: label, color, description }),
      idempotency: "nonIdempotent"
    },
    notFound: "invisible"
  }),
  addLabel: (repository, item, label) => ({
    request: {
      url: `${issuePath2(repository, item)}/labels`,
      method: "POST",
      body: JSON.stringify({ labels: [label] }),
      idempotency: "idempotent"
    },
    notFound: "invisible"
  }),
  removeLabel: (repository, item, label) => ({
    request: {
      url: `${issuePath2(repository, item)}/labels/${encodeURIComponent(label)}`,
      method: "DELETE",
      idempotency: "idempotent"
    },
    notFound: "labelMayBeAbsent"
  }),
  createComment: (repository, item, body) => ({
    request: {
      url: `${issuePath2(repository, item)}/comments`,
      method: "POST",
      body: JSON.stringify({ body }),
      idempotency: "nonIdempotent"
    },
    notFound: "invisible"
  }),
  updateComment: (repository, commentId, body) => ({
    request: {
      url: `${repoPath(repository)}/issues/comments/${String(commentId)}`,
      method: "PATCH",
      body: JSON.stringify({ body }),
      idempotency: "idempotent"
    },
    notFound: "invisible"
  }),
  closePullRequest: (repository, item) => ({
    request: {
      url: pullPath2(repository, item),
      method: "PATCH",
      body: JSON.stringify({ state: "closed" }),
      idempotency: "idempotent"
    },
    notFound: "invisible"
  }),
  assign: (repository, item, login) => ({
    request: {
      url: `${issuePath2(repository, item)}/assignees`,
      method: "POST",
      body: JSON.stringify({ assignees: [login] }),
      idempotency: "idempotent"
    },
    notFound: "invisible"
  }),
  releaseAssignment: (repository, item, login) => ({
    request: {
      url: `${issuePath2(repository, item)}/assignees`,
      method: "DELETE",
      body: JSON.stringify({ assignees: [login] }),
      idempotency: "idempotent"
    },
    notFound: "invisible"
  }),
  lockIssue: (repository, item) => ({
    request: {
      url: `${issuePath2(repository, item)}/lock`,
      method: "PUT",
      headers: { "content-length": "0" },
      idempotency: "idempotent"
    },
    notFound: "invisible"
  }),
  unlockIssue: (repository, item) => ({
    request: {
      url: `${issuePath2(repository, item)}/lock`,
      method: "DELETE",
      idempotency: "idempotent"
    },
    notFound: "invisible"
  })
};
var WRITE_VERBS = Object.keys(REQUESTS);
function writeVerbsOf(repository, apply) {
  const verbs = {};
  for (const verb of WRITE_VERBS) {
    const build = REQUESTS[verb];
    const arity = build.length - 1;
    verbs[verb] = (...args) => {
      const built = build(repository, ...args.slice(0, arity));
      return apply(built.request, built.notFound, args[arity]);
    };
  }
  return verbs;
}

// src/adapter/writes/writes.ts
var LABEL_ABSENT = {
  pattern: /label does not exist/i,
  documented: "Label does not exist"
};
var conflict = (detail) => ({ outcome: "conflict", detail });
var forbidden = (detail) => ({ outcome: "forbidden", detail });
var retryLater = (detail) => ({ outcome: "retryLater", detail });
var unsupported = (detail) => ({ outcome: "unsupported", detail });
function ambiguous(idempotency, detail) {
  return idempotency === "idempotent" ? retryLater(`${detail}; re-sending this write cannot apply it twice`) : { outcome: "unknown", detail: `${detail}; the write may already have landed` };
}
function resultOfFailure(request, failure, notFound, body) {
  switch (failure.kind) {
    case "notSent":
      if (failure.reason === "contentCreationCeiling") {
        return retryLater("this hour's content-creation ceiling is reached");
      }
      return unsupported(
        failure.reason === "brokenSeam" ? `nothing was sent: ${describeFailure(failure)}` : `the endpoint matrix confirms no write at ${request.method} ${request.url}: ` + describeFailure(failure)
      );
    case "responseTooLarge":
    case "transient":
      return ambiguous(
        request.idempotency,
        `GitHub call failed: ${describeFailure(failure)}`
      );
    case "tokenExpired":
      return retryLater("the installation token had expired and has been dropped");
    case "primaryExhausted":
      return retryLater(
        "GitHub primary rate limit reached; the budget resets at " + (failure.resetAt ?? "an instant GitHub did not report")
      );
    case "secondaryLimit":
      return retryLater(
        failure.retryAfterSeconds === void 0 ? "GitHub secondary rate limit reached, with no retry-after to wait on" : `GitHub secondary rate limit reached; retry-after ${String(failure.retryAfterSeconds)}s`
      );
    case "rateLimitResponseUnusable":
      return retryLater(
        `GitHub rate limit reached; ${failure.headerName} "${failure.headerValue}" is ${failure.reason}`
      );
    case "notFoundOrNotInstalled":
      if (notFound === "labelMayBeAbsent" && LABEL_ABSENT.pattern.test(body)) {
        return { outcome: "already" };
      }
      return forbidden(
        "GitHub answered 404: the item is absent or outside the installation, and the two cannot be told apart"
      );
    case "permissionMissing":
      return forbidden(`GitHub wants the permission ${failure.acceptedPermissions}`);
    case "installationSuspended":
      return forbidden("the App installation is suspended");
    case "forbiddenUnrecognized":
      return forbidden(`GitHub denied the write: ${failure.bodySnippet}`);
    case "badCredentials":
      return forbidden("GitHub rejected the App's credentials");
    case "validationError":
      return conflict("GitHub refused the write as invalid against the item's current state");
    case "redirected":
      return conflict(
        `GitHub redirected the write to ${failure.location ?? "an undisclosed location"}`
      );
    case "clientError":
      return conflict(`GitHub refused the write with ${String(failure.status)}`);
  }
}
function createWriteVerbs({ http, repository }) {
  const apply = async (request, notFound, allowance) => {
    const outcome = await http.request(request, allowance);
    if (outcome.ok) return { outcome: "applied" };
    return resultOfFailure(request, outcome.failure, notFound, outcome.body ?? "");
  };
  return writeVerbsOf(repository, apply);
}

// src/adapter/writes/readback.ts
var ABSENCE_CONFIRMATION_GAP_MS = 1e3;
var READ_BACK_PAGE_SIZE = 100;
var MAX_READ_BACK_PAGES = 5;
function authoredByApp(entry, identity) {
  const viaAppId = field(field(entry, "performed_via_github_app"), "id");
  if (typeof viaAppId === "number" && String(viaAppId) === identity.appId) return true;
  const user = field(entry, "user");
  return field(user, "type") === "Bot" && field(user, "login") === identity.botLogin;
}
function commentFactOf(entry, identity) {
  const id = field(entry, "id");
  const body = field(entry, "body");
  if (typeof id !== "number" || !Number.isSafeInteger(id) || typeof body !== "string") {
    return null;
  }
  const createdAt = field(entry, "created_at");
  const updatedAt = field(entry, "updated_at");
  return {
    id,
    body,
    authoredByApp: authoredByApp(entry, identity),
    ...typeof createdAt === "string" ? { createdAt } : {},
    ...typeof updatedAt === "string" ? { updatedAt } : {}
  };
}
function labelNameOf(entry) {
  const name = field(entry, "name");
  return typeof name === "string" && name.length > 0 ? name : null;
}
function itemFactsOf(body, kind) {
  const record2 = jsonRecordOf(body);
  if (record2 === null) return null;
  const state = field(record2, "state");
  if (state !== "open" && state !== "closed") return null;
  const locked3 = field(record2, "locked");
  if (typeof locked3 !== "boolean") return null;
  const entries = field(record2, "labels");
  if (!Array.isArray(entries)) return null;
  const labels = [];
  for (const entry of entries) {
    const name = labelNameOf(entry);
    if (name === null) return null;
    labels.push(name);
  }
  const closed = state === "closed";
  if (kind === "issue") return { labels, closed, merged: false, draft: false, locked: locked3 };
  const merged = field(record2, "merged");
  const draft = field(record2, "draft");
  return typeof merged === "boolean" && typeof draft === "boolean" ? { labels, closed, merged, draft, locked: locked3 } : null;
}
function createReadBack({
  http,
  repository,
  identity,
  clock,
  sleep,
  allowance
}) {
  const reads = { http, repository, ...allowance === void 0 ? {} : { allowance } };
  const readList = async (base) => {
    const entries = [];
    let lastPage = 1;
    for (let page = 1; page <= MAX_READ_BACK_PAGES; page += 1) {
      const outcome = await http.request(
        {
          url: `${base}?per_page=${String(READ_BACK_PAGE_SIZE)}&page=${String(page)}`,
          method: "GET"
        },
        allowance
      );
      if (!outcome.ok) {
        return {
          ok: false,
          detail: `GitHub refused the read: ${describeFailure(outcome.failure)}`
        };
      }
      const parsed2 = jsonArrayOf(outcome.body);
      if (parsed2 === null) {
        return { ok: false, detail: "GitHub's list body was not a JSON array" };
      }
      entries.push(...parsed2);
      const link = outcome.headers.link;
      if (page === 1) {
        const named2 = lastPageFromLink(link);
        if (named2 !== null && named2 > MAX_READ_BACK_PAGES) {
          return {
            ok: false,
            detail: `the list is longer than ${String(MAX_READ_BACK_PAGES)} pages`
          };
        }
        lastPage = named2 ?? lastPage;
      }
      if (page >= lastPage && !advertisesNextPage(link)) return { ok: true, value: entries };
    }
    return {
      ok: false,
      detail: `the list is longer than ${String(MAX_READ_BACK_PAGES)} pages`
    };
  };
  const readMapped = async (base, readOne, what) => {
    const raw = await readList(base);
    if (!raw.ok) return raw;
    const values = [];
    for (const entry of raw.value) {
      const value = readOne(entry);
      if (value === null)
        return { ok: false, detail: `GitHub returned an unreadable ${what}` };
      values.push(value);
    }
    return { ok: true, value: values };
  };
  const issuePath3 = (item) => `${repoPath(repository)}/issues/${String(item.number)}`;
  const comments = (item) => readMapped(
    `${issuePath3(item)}/comments`,
    (entry) => commentFactOf(entry, identity),
    "comment"
  );
  const labels = (item) => readMapped(`${issuePath3(item)}/labels`, labelNameOf, "label");
  const readItem = async (item) => {
    const resource = item.kind === "issue" ? "issues" : "pulls";
    const outcome = await http.request(
      {
        url: `${repoPath(repository)}/${resource}/${String(item.number)}`,
        method: "GET"
      },
      allowance
    );
    if (!outcome.ok) {
      return {
        ok: false,
        detail: `GitHub refused the read: ${describeFailure(outcome.failure)}`
      };
    }
    const facts = itemFactsOf(outcome.body, item.kind);
    return facts === null ? { ok: false, detail: "GitHub returned an unreadable item" } : { ok: true, value: facts };
  };
  const presenceOf = async (read, matches) => {
    const first = await read();
    if (!first.ok) return "unknown";
    if (first.value.some(matches)) return "present";
    let firstAt;
    try {
      firstAt = clock().getTime();
    } catch {
      return "unknown";
    }
    try {
      await sleep(ABSENCE_CONFIRMATION_GAP_MS);
    } catch {
      return "unknown";
    }
    const second = await read();
    if (!second.ok) return "unknown";
    if (second.value.some(matches)) return "present";
    let secondAt;
    try {
      secondAt = clock().getTime();
    } catch {
      return "unknown";
    }
    return secondAt - firstAt >= ABSENCE_CONFIRMATION_GAP_MS ? "absent" : "unknown";
  };
  const changesRequestedOn = async (item) => item.kind === "pullRequest" ? await readChangesRequested(reads, item.number) : { ok: true, value: false };
  const labelDefined = async (label) => {
    const outcome = await http.request({
      url: `${repoPath(repository)}/labels/${encodeURIComponent(label)}`,
      method: "GET"
    });
    if (outcome.ok) return "present";
    return outcome.failure.kind === "notFoundOrNotInstalled" ? "absent" : "unknown";
  };
  return {
    comments,
    labels,
    item: readItem,
    changesRequested: changesRequestedOn,
    pullRequestActivity: (item, working) => item.kind === "pullRequest" ? readPullRequestActivity(reads, item.number, working) : Promise.resolve({ ok: true, value: null }),
    // The resolvers' reader, not a second one: assignees arrive whole on the item (6.9).
    assignees: (item) => readAssigneesOf(reads, item.number),
    commentPresence: (item, matches) => presenceOf(() => comments(item), matches),
    // Exact names: this asks about the managed name the platform itself wrote (D4).
    labelPresence: (item, label) => presenceOf(
      () => labels(item),
      (name) => name === label
    ),
    labelDefined
  };
}

// src/adapter/client/endpoints.ts
function isEncodedSegment(segment) {
  if (segment === void 0 || segment.length === 0) return false;
  try {
    return encodeURIComponent(decodeURIComponent(segment)) === segment;
  } catch {
    return false;
  }
}
function isNumberSegment(segment) {
  return segment !== void 0 && /^[1-9][0-9]*$/.test(segment);
}
function itemStaledBy(url, origin, list) {
  const item = `${origin}${url.pathname.split("/").slice(0, 6).join("/")}`;
  return [item, `${item}/${list}`, `${item}/timeline`];
}
function itemViewsStaledBy(url, origin) {
  const [, , owner, repo, , number] = url.pathname.split("/");
  const repository = `${origin}/repos/${String(owner)}/${String(repo)}`;
  const issue = `${repository}/issues/${String(number)}`;
  return [issue, `${issue}/timeline`, `${repository}/pulls/${String(number)}`];
}
var CREATE_LABEL = {
  endpoint: "createLabel",
  resource: "labels",
  grant: "issues:write",
  body: "json",
  lane: "default",
  matches: (method, rest) => method === "POST" && rest.length === 0,
  invalidates: (url, origin) => [`${origin}${url.pathname}`]
};
var ADD_LABEL = {
  endpoint: "addLabel",
  resource: "issues",
  grant: "issues:write",
  body: "json",
  lane: "default",
  matches: (method, rest) => method === "POST" && rest.length === 2 && isNumberSegment(rest[0]) && rest[1] === "labels",
  invalidates: (url, origin) => itemStaledBy(url, origin, "labels")
};
var REMOVE_LABEL = {
  endpoint: "removeLabel",
  resource: "issues",
  grant: "issues:write",
  body: "none",
  lane: "default",
  matches: (method, rest) => method === "DELETE" && rest.length === 3 && isNumberSegment(rest[0]) && rest[1] === "labels" && isEncodedSegment(rest[2]),
  invalidates: (url, origin) => itemStaledBy(url, origin, "labels")
};
var CREATE_COMMENT = {
  endpoint: "createComment",
  resource: "issues",
  grant: "issues:write",
  body: "json",
  lane: "contentCreation",
  matches: (method, rest) => method === "POST" && rest.length === 2 && isNumberSegment(rest[0]) && rest[1] === "comments",
  invalidates: (url, origin) => itemStaledBy(url, origin, "comments")
};
var UPDATE_COMMENT = {
  endpoint: "updateComment",
  resource: "issues",
  grant: "issues:write",
  body: "json",
  lane: "default",
  matches: (method, rest) => method === "PATCH" && rest.length === 2 && rest[0] === "comments" && isNumberSegment(rest[1]),
  invalidates: (url, origin) => [`${origin}${url.pathname}`]
};
var CLOSE_PULL_REQUEST = {
  endpoint: "closePullRequest",
  resource: "pulls",
  grant: "pull_requests:write",
  body: "json",
  lane: "default",
  matches: (method, rest) => method === "PATCH" && rest.length === 1 && isNumberSegment(rest[0]),
  invalidates: itemViewsStaledBy
};
var ASSIGN = {
  endpoint: "assign",
  resource: "issues",
  grant: "issues:write",
  body: "json",
  lane: "default",
  matches: (method, rest) => method === "POST" && rest.length === 2 && isNumberSegment(rest[0]) && rest[1] === "assignees",
  invalidates: itemViewsStaledBy
};
var RELEASE_ASSIGNMENT = {
  endpoint: "releaseAssignment",
  resource: "issues",
  grant: "issues:write",
  body: "json",
  lane: "default",
  matches: (method, rest) => method === "DELETE" && rest.length === 2 && isNumberSegment(rest[0]) && rest[1] === "assignees",
  invalidates: itemViewsStaledBy
};
var LOCK_ISSUE = {
  endpoint: "lockIssue",
  resource: "issues",
  grant: "issues:write",
  body: "none",
  lane: "default",
  matches: (method, rest) => method === "PUT" && rest.length === 2 && isNumberSegment(rest[0]) && rest[1] === "lock",
  invalidates: itemViewsStaledBy
};
var UNLOCK_ISSUE = {
  endpoint: "unlockIssue",
  resource: "issues",
  grant: "issues:write",
  body: "none",
  lane: "default",
  matches: (method, rest) => method === "DELETE" && rest.length === 2 && isNumberSegment(rest[0]) && rest[1] === "lock",
  invalidates: itemViewsStaledBy
};
var CONFIRMED_WRITE_ENDPOINTS = {
  createLabel: CREATE_LABEL,
  addLabel: ADD_LABEL,
  removeLabel: REMOVE_LABEL,
  createComment: CREATE_COMMENT,
  updateComment: UPDATE_COMMENT,
  closePullRequest: CLOSE_PULL_REQUEST,
  assign: ASSIGN,
  releaseAssignment: RELEASE_ASSIGNMENT,
  lockIssue: LOCK_ISSUE,
  unlockIssue: UNLOCK_ISSUE
};
function writeEndpointOf(method, url, origin = GITHUB_API_ORIGIN) {
  if (url.search !== "" || url.hash !== "") return null;
  const [repos, owner, repo, resource, ...rest] = url.pathname.split("/").slice(1);
  if (repos !== "repos") return null;
  if (!isEncodedSegment(owner) || !isEncodedSegment(repo)) return null;
  for (const shape of Object.values(CONFIRMED_WRITE_ENDPOINTS)) {
    if (shape.resource === resource && shape.matches(method, rest)) {
      return {
        endpoint: shape.endpoint,
        grant: shape.grant,
        body: shape.body,
        lane: shape.lane,
        invalidates: shape.invalidates(url, origin)
      };
    }
  }
  return null;
}

// src/adapter/client/admission.ts
function githubApiUrl(rawUrl, origin) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, refused: "malformedUrl" };
  }
  return url.origin === origin ? { ok: true, url } : { ok: false, refused: "disallowedOrigin" };
}
var refused = (reason) => ({
  ok: false,
  refusal: notSentFailure(reason)
});
var GRAPHQL_OPERATIONS = {
  LinkedIssues: ["issues:read", "pull_requests:read"],
  LinkedIssuesBatch: ["issues:read", "pull_requests:read"]
};
function operationOf2(body) {
  const named2 = jsonRecordOf(body);
  if (named2 === null) return null;
  const operationName = named2["operationName"];
  const query = named2["query"];
  if (typeof operationName !== "string" || typeof query !== "string") return null;
  if (!Object.hasOwn(GRAPHQL_OPERATIONS, operationName)) return null;
  return new RegExp(`^\\s*query\\s+${operationName}(?:\\s|\\()`).test(query) ? operationName : null;
}
function admitGraphql(request, url, origin) {
  if (url.href !== `${origin}/graphql`) return refused("disallowedMethod");
  if (typeof request.body !== "string") return refused("invalidBody");
  const operation = operationOf2(request.body);
  if (operation === null) return refused("invalidBody");
  return {
    ok: true,
    request: { ...request, url: url.href },
    write: null,
    reads: GRAPHQL_OPERATIONS[operation]
  };
}
function admitWrite(request, url, origin) {
  const write = writeEndpointOf(request.method, url, origin);
  if (write === null) return refused("disallowedMethod");
  if (request.idempotency !== "idempotent" && request.idempotency !== "nonIdempotent") {
    return refused("invalidBody");
  }
  const body = bodyOf(request);
  if (write.body === "none") {
    if (body !== void 0) return refused("invalidBody");
  } else {
    if (body === void 0 || jsonRecordOf(body) === null) return refused("invalidBody");
  }
  return { ok: true, request: { ...request, url: url.href }, write, reads: [] };
}
function admit(request, origin = GITHUB_API_ORIGIN) {
  const write = isWrite(request);
  if (!write && request.method !== "GET" && request.method !== "POST") {
    return refused("disallowedMethod");
  }
  const parsed2 = githubApiUrl(request.url, origin);
  if (!parsed2.ok) return refused(parsed2.refused);
  if (write) return admitWrite(request, parsed2.url, origin);
  if (request.method === "POST") return admitGraphql(request, parsed2.url, origin);
  return { ok: true, request: { ...request, url: parsed2.url.href }, write: null, reads: [] };
}
function hasReadGrant(token, required) {
  const write = `${required.slice(0, -4)}write`;
  return token.grants.some((grant) => grant === required || grant === write);
}
function missingGrants(reads, write, token) {
  if (write !== null) {
    return token.grants.some((grant) => grant === write.grant) ? [] : [write.grant];
  }
  return reads.filter((grant) => !hasReadGrant(token, grant));
}

// src/adapter/client/http.ts
var DEFAULT_ETAG_CACHE_ENTRIES = 1e3;
var DEFAULT_ETAG_CACHE_BYTES = 20 * 1024 * 1024;
var DEFAULT_ETAG_CACHE_ENTRY_BYTES = 512 * 1024;
var MAX_RESPONSE_BODY_BYTES = 8 * DEFAULT_ETAG_CACHE_ENTRY_BYTES;
var DEFAULT_ACCEPT = "application/vnd.github+json";
var TOKEN_REFRESH_ATTEMPTS = 2;
var TRANSIENT_ATTEMPTS = 2;
var MAX_RETRY_WAIT_MS = 3e4;
var BACKOFF_JITTER_FRACTION = 0.25;
var PRIMARY_BUDGET_RESERVE = 50;
var SECONDARY_LIMIT_HOLD_MS = 6e4;
var CONTENT_CREATION_SPACING_MS = 2e3;
var CONTENT_CREATION_HOURLY = 400;
var HOUR_MS5 = 60 * 6e4;
var wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function responseClassOf(failure) {
  return failure.kind === "notSent" || failure.kind === "responseTooLarge" ? null : failure;
}
function attemptCap(kind) {
  if (kind === "tokenExpired") return TOKEN_REFRESH_ATTEMPTS;
  if (kind === "transient") return TRANSIENT_ATTEMPTS;
  return MAX_RATE_LIMIT_ATTEMPTS;
}
function mayRetryInClient(request) {
  return !isWrite(request) || request.idempotency === "idempotent";
}
function jitterMs(kind, advisedMs, now) {
  if (kind !== "transient") return 0;
  const span = Math.floor(advisedMs * BACKOFF_JITTER_FRACTION);
  return span < 1 ? 0 : now.getTime() % span;
}
function nextStep(failure, attempt, now, waitedMs) {
  if (attempt + 1 >= attemptCap(failure.kind)) return { step: "return" };
  const advice = retryAdvice(failure, attempt, Math.floor(now.getTime() / 1e3));
  if (advice.action === "doNotRetry") return { step: "return" };
  if (advice.action === "refreshTokenAndRetry") return { step: "refreshToken" };
  const ms = advice.ms + jitterMs(failure.kind, advice.ms, now);
  return waitedMs + ms > MAX_RETRY_WAIT_MS ? { step: "return" } : { step: "wait", ms };
}
function createRepresentationCache() {
  const entries = /* @__PURE__ */ new Map();
  let retainedBytes = 0;
  const remove = (url) => {
    const entry = entries.get(url);
    if (entry !== void 0) {
      retainedBytes -= entry.body.length;
      entries.delete(url);
    }
  };
  return {
    lookup(url, variant) {
      const entry = entries.get(url);
      if (entry === void 0 || entry.variant !== variant) return void 0;
      entries.delete(url);
      entries.set(url, entry);
      return entry;
    },
    /** Insert as newest, then evict oldest-first until under both bounds. */
    store(url, entry) {
      remove(url);
      entries.set(url, entry);
      retainedBytes += entry.body.length;
      while (entries.size > DEFAULT_ETAG_CACHE_ENTRIES || retainedBytes > DEFAULT_ETAG_CACHE_BYTES) {
        remove(entries.keys().next().value);
      }
    },
    remove,
    removeResource(url) {
      for (const key of [...entries.keys()]) {
        if (key === url || key.startsWith(`${url}?`)) remove(key);
      }
    }
  };
}
function representationHeaders(headers) {
  const link = headers.link;
  return link === void 0 ? {} : { link };
}
function rateLimitHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.startsWith("x-ratelimit-"))
  );
}
function poolOf(request) {
  return !isWrite(request) && request.method === "POST" ? "graphql" : "core";
}
function chargedPool(headers, aimedAt) {
  const resource = headers["x-ratelimit-resource"];
  if (resource === "graphql") return "graphql";
  return resource === "core" ? "core" : aimedAt;
}
function pointsIn(body) {
  const cost = field(field(field(jsonRecordOf(body), "data"), "rateLimit"), "cost");
  return typeof cost === "number" && Number.isInteger(cost) && cost > 0 ? cost : null;
}
async function boundedText(response) {
  const stream = response.body;
  if (stream === null) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text3 = "";
  let bytes = 0;
  for (; ; ) {
    const chunk = await reader.read();
    if (chunk.done) return text3 + decoder.decode();
    bytes += chunk.value.length;
    if (bytes > MAX_RESPONSE_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
      }
      return null;
    }
    text3 += decoder.decode(chunk.value, { stream: true });
  }
}
function prepareHeaders(request, token) {
  let headers;
  try {
    headers = new Headers(request.headers);
  } catch {
    return { ok: false, refusal: notSentFailure("invalidHeaders") };
  }
  headers.set("accept", headers.get("accept") ?? DEFAULT_ACCEPT);
  headers.delete("authorization");
  headers.delete("if-none-match");
  headers.delete("user-agent");
  headers.delete("x-github-api-version");
  if (bodyOf(request) !== void 0) {
    headers.delete("content-length");
    headers.set("content-type", "application/json");
  }
  const variant = JSON.stringify(headersToRecord(headers));
  try {
    headers.set("authorization", `Bearer ${token.value}`);
    headers.set("user-agent", USER_AGENT);
    headers.set("x-github-api-version", GITHUB_API_VERSION);
  } catch {
    return { ok: false, refusal: brokenSeamFailure("tokenValue") };
  }
  return { ok: true, headers, variant };
}
var settled = () => void 0;
function createGitHubHttpClient({
  tokenSource,
  fetch: send = fetch,
  clock = () => /* @__PURE__ */ new Date(),
  sleep = wait,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  timeoutSignal = AbortSignal.timeout,
  contentCreationHourly = CONTENT_CREATION_HOURLY,
  apiOrigin = GITHUB_API_ORIGIN
}) {
  const cache = createRepresentationCache();
  const slots = /* @__PURE__ */ new Map();
  let latestResource = null;
  const rememberRateLimit = (resource, url, status, headers) => {
    slots.set(resource, { url, status, headers: rateLimitHeaders(headers) });
    latestResource = resource;
  };
  const pacingClass = (pool) => {
    const slot = slots.get(pool);
    if (slot === void 0) return null;
    const remaining = parseSecondsHeader(slot.headers["x-ratelimit-remaining"]);
    const resetAt = slot.headers["x-ratelimit-reset"];
    if (remaining.kind !== "valid" || remaining.seconds >= PRIMARY_BUDGET_RESERVE) return null;
    return parseSecondsHeader(resetAt).kind === "valid" ? { kind: "primaryExhausted", resetAt } : null;
  };
  let secondaryHeldUntil = null;
  const holdForSecondaryLimit = (retryAfterSeconds) => {
    let now;
    try {
      now = clock().getTime();
    } catch {
      return;
    }
    const until = now + Math.max(SECONDARY_LIMIT_HOLD_MS, (retryAfterSeconds ?? 0) * 1e3);
    secondaryHeldUntil = Math.max(secondaryHeldUntil ?? until, until);
  };
  const heldBySecondaryLimit = () => {
    if (secondaryHeldUntil === null) return null;
    let now;
    try {
      now = clock().getTime();
    } catch {
      return brokenSeamFailure("clock");
    }
    if (now >= secondaryHeldUntil) {
      secondaryHeldUntil = null;
      return null;
    }
    const retryAfterSeconds = Math.ceil((secondaryHeldUntil - now) / 1e3);
    return { ok: false, failure: { kind: "secondaryLimit", retryAfterSeconds } };
  };
  const sendOnce = async (request, token, pool) => {
    const prepared = prepareHeaders(request, token);
    if (!prepared.ok) return prepared.refusal;
    const { headers, variant } = prepared;
    const requestBody = bodyOf(request);
    const cached = request.method === "GET" ? cache.lookup(request.url, variant) : void 0;
    if (cached !== void 0) headers.set("if-none-match", cached.etag);
    let tokenPastExpiry;
    try {
      tokenPastExpiry = isPastExpiry(token, clock());
    } catch {
      return brokenSeamFailure("clock");
    }
    let signal;
    try {
      signal = timeoutSignal(timeoutMs);
    } catch {
      return brokenSeamFailure("timeoutSignal");
    }
    const init = {
      method: request.method,
      headers,
      // Following is not delegated to fetch: a hidden 3xx would evade every check here.
      redirect: "manual",
      signal,
      ...requestBody === void 0 ? {} : { body: requestBody }
    };
    let response;
    try {
      response = await send(request.url, init);
    } catch {
      return transportFailure();
    }
    const responseHeaders = headersToRecord(response.headers);
    rememberRateLimit(
      chargedPool(responseHeaders, pool),
      request.url,
      response.status,
      responseHeaders
    );
    if (response.status === 304) {
      if (cached === void 0) {
        return {
          ok: false,
          status: response.status,
          body: "",
          headers: responseHeaders,
          failure: { kind: "transient" }
        };
      }
      return {
        ok: true,
        status: response.status,
        body: cached.body,
        headers: { ...cached.headers, ...responseHeaders },
        fromCache: true
      };
    }
    let read;
    try {
      read = await boundedText(response);
    } catch {
      return {
        ok: false,
        status: response.status,
        headers: responseHeaders,
        failure: { kind: "transient" }
      };
    }
    if (read === null) {
      return {
        ok: false,
        status: response.status,
        headers: responseHeaders,
        failure: { kind: "responseTooLarge", limitBytes: MAX_RESPONSE_BODY_BYTES }
      };
    }
    const body = read;
    if (response.ok) {
      if (response.status === 200 && request.method === "GET") {
        const etag = response.headers.get("etag");
        if (etag !== null && body.length <= DEFAULT_ETAG_CACHE_ENTRY_BYTES) {
          cache.store(request.url, {
            etag,
            variant,
            body,
            headers: representationHeaders(responseHeaders)
          });
        } else {
          cache.remove(request.url);
        }
      }
      return {
        ok: true,
        status: response.status,
        body,
        headers: responseHeaders,
        fromCache: false
      };
    }
    return {
      ok: false,
      status: response.status,
      body,
      headers: responseHeaders,
      failure: classifyFailure({
        status: response.status,
        body,
        headers: responseHeaders,
        tokenPastExpiry
      })
    };
  };
  let creationLane = Promise.resolve();
  let lastCreationAt = null;
  let creationHourFrom = null;
  let createdThisHour = 0;
  const takeCreationSlot = (at2) => {
    if (creationHourFrom === null || at2 - creationHourFrom >= HOUR_MS5) {
      creationHourFrom = at2;
      createdThisHour = 0;
    }
    if (createdThisHour >= contentCreationHourly) return false;
    createdThisHour += 1;
    return true;
  };
  const spaceCreation = async () => {
    let startedAt2;
    try {
      startedAt2 = clock().getTime();
    } catch {
      return brokenSeamFailure("clock");
    }
    if (!takeCreationSlot(startedAt2)) return notSentFailure("contentCreationCeiling");
    const due = lastCreationAt === null ? 0 : lastCreationAt + CONTENT_CREATION_SPACING_MS;
    if (due > startedAt2) {
      try {
        await sleep(due - startedAt2);
      } catch {
        return brokenSeamFailure("sleep");
      }
    }
    try {
      lastCreationAt = clock().getTime();
    } catch {
      return brokenSeamFailure("clock");
    }
    return null;
  };
  const throughCreationLane = (work) => {
    const run2 = creationLane.then(async () => {
      const stopped = heldBySecondaryLimit() ?? await spaceCreation();
      return stopped ?? work();
    });
    creationLane = run2.then(settled, settled);
    return run2;
  };
  return {
    async request(request, allowance) {
      const admitted = admit(onOrigin(request, apiOrigin), apiOrigin);
      if (!admitted.ok) return admitted.refusal;
      const safeRequest = admitted.request;
      const write = admitted.write;
      const retriable = mayRetryInClient(safeRequest);
      const pool = poolOf(safeRequest);
      const charge = (outcome2) => {
        if (allowance === void 0 || outcome2.status === void 0) return;
        const headers = outcome2.headers ?? {};
        const charged = chargedPool(headers, pool);
        allowance.observed(charged, headers);
        allowance.charge({
          pool: charged,
          mutation: write !== null,
          status: outcome2.status,
          points: charged === "graphql" ? pointsIn(outcome2.body ?? "") : null
        });
      };
      let waitedMs = 0;
      const move = (failure, attempt) => {
        let now;
        try {
          now = clock();
        } catch {
          return "brokenClock";
        }
        return nextStep(failure, attempt, now, waitedMs);
      };
      const rest = async (ms) => {
        waitedMs += ms;
        try {
          await sleep(ms);
        } catch {
          return brokenSeamFailure("sleep");
        }
        return null;
      };
      const deliver = async () => {
        const paced = pacingClass(pool);
        if (paced !== null) {
          const step = move(paced, 0);
          if (step === "brokenClock") return brokenSeamFailure("clock");
          if (step.step !== "wait") return { ok: false, failure: paced };
          const broken2 = await rest(step.ms);
          if (broken2 !== null) return broken2;
        }
        let previous = null;
        for (let attempt = 0; ; attempt += 1) {
          const held2 = heldBySecondaryLimit();
          if (held2 !== null) return previous ?? held2;
          let tokenOutcome;
          try {
            tokenOutcome = await tokenSource.current();
            if (!isWellFormedTokenOutcome(tokenOutcome)) {
              return brokenSeamFailure("tokenSource");
            }
          } catch {
            return brokenSeamFailure("tokenSource");
          }
          if (!tokenOutcome.ok) return tokenOutcome;
          const missing = missingGrants(admitted.reads, write, tokenOutcome.token);
          if (missing.length > 0) {
            return {
              ok: false,
              failure: {
                kind: "permissionMissing",
                acceptedPermissions: missing.join(", ")
              }
            };
          }
          const refusing = allowance?.refuses(pool, write !== null) ?? null;
          if (refusing !== null) {
            allowance?.refused(refusing);
            return previous ?? allowanceFailure(refusing);
          }
          let outcome2;
          try {
            outcome2 = await sendOnce(safeRequest, tokenOutcome.token, pool);
          } catch {
            return brokenSeamFailure("response");
          }
          charge(outcome2);
          previous = outcome2;
          if (outcome2.ok) return outcome2;
          if (outcome2.failure.kind === "secondaryLimit") {
            holdForSecondaryLimit(outcome2.failure.retryAfterSeconds);
            return outcome2;
          }
          if (outcome2.failure.kind === "rateLimitResponseUnusable") {
            holdForSecondaryLimit(void 0);
            return outcome2;
          }
          const responseClass = responseClassOf(outcome2.failure);
          if (responseClass === null) return outcome2;
          if (responseClass.kind === "tokenExpired") {
            try {
              tokenSource.invalidate(tokenOutcome.token);
            } catch {
              return brokenSeamFailure("invalidate");
            }
          }
          if (!retriable) return outcome2;
          const step = move(responseClass, attempt);
          if (step === "brokenClock") return brokenSeamFailure("clock");
          if (step.step === "return") return outcome2;
          if (step.step === "wait") {
            const broken2 = await rest(step.ms);
            if (broken2 !== null) return broken2;
          }
        }
      };
      const outcome = write?.lane === "contentCreation" ? await throughCreationLane(deliver) : await deliver();
      if (write !== null && (outcome.ok || outcome.failure.kind !== "notSent")) {
        for (const url of write.invalidates) cache.removeResource(url);
      }
      return outcome;
    },
    latestRateLimit() {
      const latest = latestResource === null ? void 0 : slots.get(latestResource);
      return latest === void 0 ? null : { ...latest, headers: { ...latest.headers } };
    }
  };
}

// src/adapter/client/allowance.ts
var ASSUMED_POOL_LIMIT = 5e3;
var NOTHING2 = { core: 0, graphql: 0, mutations: 0 };
function costOf({ pool, mutation, status, points }) {
  if (status === null) return NOTHING2;
  if (mutation) return { core: 1, graphql: 0, mutations: 1 };
  if (pool === "graphql") return { core: 0, graphql: points ?? 1, mutations: 0 };
  return status === 304 ? NOTHING2 : { core: 1, graphql: 0, mutations: 0 };
}
var WINDOW_SLACK_S = 60;
var wholeNumber = (raw) => {
  const parsed2 = parseSecondsHeader(raw);
  return parsed2.kind === "valid" ? parsed2.seconds : null;
};
function createAllowance({
  share,
  mutations,
  onWindow,
  clock
}) {
  const pools = {
    core: { limit: ASSUMED_POOL_LIMIT, resetAt: null, spent: 0 },
    graphql: { limit: ASSUMED_POOL_LIMIT, resetAt: null, spent: 0 }
  };
  let mutationCap = mutations ?? Number.POSITIVE_INFINITY;
  let mutationsSpent = 0;
  let turnedAway = 0;
  let refusedLane = null;
  const rollIfDue = () => {
    if (clock === void 0) return;
    const now = clock();
    for (const pool of ["core", "graphql"]) {
      const ledger = pools[pool];
      if (ledger.resetAt !== null && now >= ledger.resetAt * 1e3) {
        ledger.resetAt = null;
        ledger.spent = 0;
      }
    }
  };
  const capOf = (pool) => Math.floor(share * pools[pool].limit);
  const rollsAt = (lane) => {
    const reset = lane === "mutations" ? null : pools[lane].resetAt;
    return reset === null ? null : new Date(reset * 1e3).toISOString();
  };
  const atCap2 = (pool) => pools[pool].spent >= capOf(pool);
  return {
    spent: () => {
      rollIfDue();
      return {
        core: pools.core.spent,
        graphql: pools.graphql.spent,
        mutations: mutationsSpent
      };
    },
    exhausted() {
      rollIfDue();
      if (atCap2("core")) return "core";
      if (atCap2("graphql")) return "graphql";
      return mutationsSpent >= mutationCap ? "mutations" : null;
    },
    refuses(pool, mutation) {
      rollIfDue();
      if (atCap2(pool)) return pool;
      return mutation && mutationsSpent >= mutationCap ? "mutations" : null;
    },
    refusals: () => turnedAway,
    lastRefusal: () => refusedLane === null ? null : { lane: refusedLane, resetAt: rollsAt(refusedLane) },
    standing: () => {
      rollIfDue();
      return ["core", "graphql"].map((pool) => ({
        pool,
        allowed: capOf(pool),
        spent: pools[pool].spent,
        resetAt: rollsAt(pool)
      }));
    },
    refused(lane) {
      turnedAway += 1;
      refusedLane = lane;
    },
    charge(exchange) {
      const cost = costOf(exchange);
      pools.core.spent += cost.core;
      pools.graphql.spent += cost.graphql;
      mutationsSpent += cost.mutations;
    },
    /**
     * A reset past the slack is a new window: its spend starts again. Drift inside it only moves
     * the end. A later reset while this window's own end has not passed is another pool's
     * answer, never this one's roll: the spend stands until the clock passes the end (D231).
     */
    observed(pool, headers) {
      const ledger = pools[pool];
      const limit = wholeNumber(headers["x-ratelimit-limit"]);
      if (limit !== null && limit > 0) ledger.limit = limit;
      const reset = wholeNumber(headers["x-ratelimit-reset"]);
      if (reset === null || ledger.resetAt !== null && reset <= ledger.resetAt) return;
      if (clock !== void 0 && reset * 1e3 <= clock()) return;
      if (ledger.resetAt !== null && reset <= ledger.resetAt + WINDOW_SLACK_S) {
        ledger.resetAt = reset;
        return;
      }
      if (clock !== void 0 && ledger.resetAt !== null && clock() < ledger.resetAt * 1e3) {
        return;
      }
      ledger.resetAt = reset;
      ledger.spent = 0;
      onWindow?.({
        pool,
        limit: ledger.limit,
        remaining: wholeNumber(headers["x-ratelimit-remaining"]) ?? ledger.limit,
        resetAt: new Date(reset * 1e3).toISOString()
      });
    },
    armMutations(calls) {
      mutationCap = calls;
      mutationsSpent = 0;
    }
  };
}

// src/shell/compose/live.ts
function authenticate(auth, clock, apiOrigin) {
  if (auth.kind === "token") {
    return {
      tokenSource: staticTokenSource(auth.token),
      identityFor: () => auth.identity,
      identity: auth.identity
    };
  }
  const { appId, installationId, privateKeyPath } = auth.credentials;
  let privateKeyPem;
  try {
    privateKeyPem = readFileSync(privateKeyPath, "utf8");
  } catch {
    console.error(`PRIVATE_KEY_PATH could not be read: ${privateKeyPath}`);
    process.exit(1);
  }
  return {
    tokenSource: createTokenSource({
      credentials: { appId, installationId, privateKeyPem },
      mint: githubMintInstallationToken(apiOrigin === void 0 ? {} : { apiOrigin }),
      clock
    }),
    identityFor: (appSlug) => ({ appId, botLogin: `${appSlug}[bot]` }),
    identity: null
  };
}
function liveGitHub({
  auth,
  writes,
  killSwitchActive,
  clock,
  share,
  lanes = "two",
  contentCreationHourly,
  apiOrigin,
  knownCapabilities,
  ownWrites,
  log
}) {
  const { tokenSource, identityFor, identity } = authenticate(auth, clock, apiOrigin);
  const http = createGitHubHttpClient({
    tokenSource,
    ...contentCreationHourly === null ? {} : { contentCreationHourly },
    ...apiOrigin === void 0 ? {} : { apiOrigin }
  });
  const sweepAllowance = createAllowance({
    share: lanes === "one" ? 1 : share,
    clock: () => clock().getTime(),
    onWindow: ({ pool, limit, remaining, resetAt }) => {
      log({ event: "limits", pool, limit, remaining, resetAt });
    }
  });
  const deliveryAllowance = lanes === "one" ? sweepAllowance : createAllowance({ share: 1 - share, clock: () => clock().getTime() });
  const seamsIn = (repository, allowance) => {
    const charged = { allowance };
    const landed2 = ownWrites(repository);
    const readerAs = (as) => createReadBack({ http, repository, ...charged, identity: as, clock, sleep: wait });
    const effectExternals = async (payload) => {
      const grants = await installationGrants(tokenSource);
      if (!grants.ok) {
        throw new Error(
          `the installation's grants could not be read: ${grants.failure.kind}`
        );
      }
      const cause = causeFingerprintOf(payload);
      return {
        killSwitchActive,
        installationGrants: grants.grants,
        latestHumanChangeAt: orderingEvidenceSource({
          http,
          repository,
          ownWrites: landed2,
          ...charged,
          ...cause === void 0 ? {} : { cause }
        })
      };
    };
    return {
      facts: (config, groups) => createFactsReader({ http, repository, config, clock, groups, ...charged }),
      configSource: githubConfigSource({ client: http, repository, ...charged }),
      // One call per delivery, so the seam below is bound to that delivery.
      externals: async ({ payload, deliveryId, config }) => {
        const outcome = await liveExternalsForDelivery(
          {
            tokenSource,
            http,
            repository,
            config,
            knownCapabilities,
            ...charged,
            ownWrites: landed2,
            onUnknownOrdering: (detail) => {
              log({ event: "orderingUnknown", deliveryId, detail });
            }
          },
          payload
        );
        if (!outcome.ok) {
          throw new Error(`live externals unavailable: ${outcome.failure.kind}`);
        }
        return { killSwitchActive, ...outcome.facts };
      },
      writePath: writes === null ? null : {
        writer: createWriteVerbs({ http, repository }),
        reader: readerAs(identityFor(writes.appSlug)),
        externals: effectExternals
      },
      ...identity === null ? {} : { reader: readerAs(identity) }
    };
  };
  const built = /* @__PURE__ */ new Map();
  return {
    sweepAllowance,
    deliveryAllowance,
    // Held seams are the webhook lane's, and spend its allowance; the sweep passes its own.
    seamsFor: (repository, allowance) => {
      if (allowance !== void 0) return seamsIn(repository, allowance);
      const key = `${repository.owner}/${repository.repo}`;
      const held2 = built.get(key) ?? seamsIn(repository, deliveryAllowance);
      built.set(key, held2);
      return held2;
    }
  };
}

// src/shell/compose/action/run.ts
var TOKEN_LIFETIME_MS = 6 * 60 * 6e4;
async function runAction(run2, options) {
  const clock = options.clock ?? (() => /* @__PURE__ */ new Date());
  const events = [];
  const sink = options.log ?? createLogger({ clock });
  const log = contained((event) => {
    events.push(event);
    sink(event);
  });
  const capabilities2 = options.capabilities ?? CAPABILITIES;
  const { store: store2, payload } = options;
  const worker = `action-${run2.deliveryId}`;
  const sweeping = run2.eventName === "schedule";
  let modeLowered = false;
  let configAbsent = false;
  const items = [];
  const effects = [];
  const live = liveGitHub({
    auth: {
      kind: "token",
      token: {
        value: run2.token,
        expiresAt: new Date(clock().getTime() + TOKEN_LIFETIME_MS),
        grants: RUNNER_GRANTS
      },
      identity: run2.identity
    },
    writes: run2.armWrites ? { appSlug: run2.identity.slug } : null,
    killSwitchActive: false,
    clock,
    share: 1,
    lanes: "one",
    contentCreationHourly: null,
    ...run2.apiOrigin === null ? {} : { apiOrigin: run2.apiOrigin },
    knownCapabilities: capabilities2.map(({ declaration }) => declaration),
    ownWrites: (served) => (item) => store2.ledger.landedOn(served, item),
    log
  });
  const deciderOver = (seams) => {
    const applier = seams.writePath === null ? void 0 : createApplier({ ledger: store2.ledger, ...seams.writePath, worker, clock, log });
    let deciding = null;
    const recorded = recordedWarningsIn(store2.ledger);
    const warningFor = async (effectId) => {
      if (deciding !== null && seams.reader !== void 0) {
        const { item, revision } = deciding;
        deciding = null;
        await hydrateWarnings({
          ledger: store2.ledger,
          reader: seams.reader,
          repository: run2.repository,
          item,
          revision
        });
      }
      return recorded(effectId);
    };
    const decide2 = createItemDecider({
      store: store2,
      capabilities: capabilities2,
      externals: async (delivery) => ({ ...await seams.externals(delivery), warningFor }),
      repository: run2.repository,
      clock,
      ...applier === void 0 ? {} : { applier }
    });
    return async (input, config2, at2, allowance) => {
      const item = input.kind === "facts" ? input.facts.item : itemNamedBy(payload);
      if (item !== null) items.push(item);
      deciding = item === null ? null : { item, revision: config2.revision };
      const lowered = config2.mode === "active" && !run2.armWrites;
      if (lowered) modeLowered = true;
      const decided = await decide2(
        input,
        lowered ? { ...config2, mode: "dry-run" } : config2,
        at2,
        allowance
      );
      if (decided.kind === "decided") effects.push(...decided.outcomes);
      return decided;
    };
  };
  const seamsFor = live.seamsFor;
  const laneSeams = seamsFor(run2.repository);
  const deliveries = createDeliveries({
    store: store2,
    capabilities: capabilities2,
    lane: () => ({ configSource: laneSeams.configSource, decideItem: deciderOver(laneSeams) }),
    repository: run2.repository,
    allowance: live.deliveryAllowance,
    worker,
    clock,
    log,
    configured: (_, config2) => {
      if (config2.revision === ABSENT_CONFIG_REVISION) configAbsent = true;
    }
  });
  if (!sweeping) {
    store2.inbox.acceptDelivery({
      deliveryId: run2.deliveryId,
      eventName: run2.eventName,
      payload,
      receivedAt: clock().toISOString()
    });
    log({ event: "deliveryAccepted", deliveryId: run2.deliveryId, eventName: run2.eventName });
    await deliveries.drain();
    const finished = events.some(
      (event) => event.event === "deliveryCompleted" && event.deliveryId === run2.deliveryId && event.kind !== "repositoryMismatch"
    );
    return {
      kind: "delivery",
      events,
      items,
      effects,
      modeLowered,
      configAbsent,
      exitCode: finished ? 0 : 1
    };
  }
  const config = await deliveries.configuration(run2.repository, laneSeams.configSource);
  if (config === null) {
    const unreadable2 = events.some(
      (event) => event.event === "configurationUnavailable" && event.reason === "unreadable"
    );
    return {
      kind: "idle",
      events,
      items,
      effects,
      modeLowered,
      configAbsent,
      exitCode: unreadable2 ? 1 : 0
    };
  }
  configAbsent = config.revision === ABSENT_CONFIG_REVISION;
  declareSweep({ store: store2, repository: run2.repository, config, capabilities: capabilities2, now: clock() });
  const sweep = createSweep({
    store: store2,
    capabilities: capabilities2,
    processorFor: (repository, allowance) => {
      const seams = seamsFor(repository, allowance);
      return {
        decideItem: deciderOver(seams),
        facts: seams.facts,
        configuration: () => deliveries.configuration(repository, seams.configSource)
      };
    },
    clock,
    cadenceMs: DEFAULT_SWEEP_CADENCE_MS,
    writeCap: SWEEP_WRITE_CALLS,
    allowance: live.sweepAllowance,
    snapshotMaxAgeMs: SNAPSHOT_MAX_AGE_MS,
    log
  });
  await sweep.runDue();
  const fired = events.some((event) => event.event === "sweepClaimed");
  const failed2 = events.some((event) => event.event === "sweepFailed");
  return {
    kind: fired ? "sweep" : "idle",
    events,
    items,
    effects,
    modeLowered,
    configAbsent,
    exitCode: failed2 ? 1 : 0
  };
}
function runStore() {
  return new Store(":memory:");
}

// src/shell/compose/action/main.ts
var parsed = parseActionEnvironment(process.env);
if (!parsed.ok) {
  for (const refusal2 of parsed.errors) console.error(refusal2);
  process.exit(1);
}
var { run } = parsed;
var store = runStore();
try {
  const outcome = await runAction(run, { payload: readFileSync2(run.eventPath), store });
  appendSummary(process.env["GITHUB_STEP_SUMMARY"], renderSummary(store, run, outcome));
  const lines = [...annotations(outcome), ...rowLines(store, run.repository, outcome)];
  for (const line2 of lines) console.log(line2);
  process.exitCode = outcome.exitCode;
} finally {
  store.close();
}
