#!/usr/bin/env node
// Validates the electron-builder "build" block against the schema shipped with
// the installed electron-builder. A bad field here otherwise fails the release
// workflow after a full packaging run, or worse, only on one platform's job.
// ajv ships an ES-module-style default export that CommonJS sees as a wrapper
// object under some versions; take the callable off it either way.
/** @type {any} */
const AjvModule = require("ajv");
const Ajv = AjvModule.default || AjvModule;
const scheme = require("../node_modules/app-builder-lib/scheme.json");
const config = require("../package.json").build;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(scheme);

if (validate(config)) {
  console.log("electron-builder config: valid");
  process.exit(0);
}

console.error("electron-builder config is invalid:");
for (const err of validate.errors) {
  const where = err.instancePath || "(root)";
  const extra = err.params && Object.keys(err.params).length ? ` ${JSON.stringify(err.params)}` : "";
  console.error(`  ${where} ${err.message}${extra}`);
}
process.exit(1);
