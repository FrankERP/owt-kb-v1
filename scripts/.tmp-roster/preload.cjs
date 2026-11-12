const Module = require("node:module");
const path = require("node:path");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return path.join(__dirname, "empty.cjs");
  if (request === "next/cache") return path.join(__dirname, "cache.cjs");
  return orig.call(this, request, ...rest);
};
