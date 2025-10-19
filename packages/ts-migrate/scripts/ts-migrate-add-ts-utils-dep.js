/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const fs = require('fs');
const path = require('path');
const JSON10 = require('json10');
const json10Writer = require('json10-writer');

const json = JSON10.JSON10;

if (process.argv.length < 3) {
  console.error('Must provide frontend folder arg');
  process.exit(1);
}

const project = path.basename(process.argv[2]);
const rootDir = path.resolve(__dirname, '../../..');
const projectDir = path.resolve(rootDir, 'frontend', project);
if (!fs.existsSync(projectDir)) {
  console.error(`Project "${project}" does not exist at "${projectDir}"`);
  process.exit(1);
}

const projectJsonPath = path.resolve(projectDir, 'project.json');
const projectJsonText = fs.readFileSync(projectJsonPath, 'utf-8');
const projectJsonConfig = json.parse(projectJsonText);
if (
  !projectJsonConfig.internalDependencies ||
  !projectJsonConfig.internalDependencies['ts-utils']
) {
  projectJsonConfig.internalDependencies = projectJsonConfig.internalDependencies || {};
  projectJsonConfig.internalDependencies['ts-utils'] = true;

  const writer = json10Writer.load(projectJsonText);
  writer.write(projectJsonConfig);
  fs.writeFileSync(
    projectJsonPath,
    writer.toSource({ quote: 'double', trailingComma: false, quoteKeys: true }),
    'utf-8',
  );
}
