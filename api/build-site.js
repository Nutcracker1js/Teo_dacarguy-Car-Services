const fs = require('node:fs/promises');
const path = require('node:path');

const PUBLIC_FILE_EXTENSIONS = new Set(['.html', '.js', '.css']);

async function copyPublicFiles(sourceDirectory, outputDirectory) {
  const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
  const files = entries.filter((entry) => (
    entry.isFile() && PUBLIC_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
  ));

  await fs.mkdir(outputDirectory, { recursive: true });
  await Promise.all(files.map((entry) => (
    fs.copyFile(
      path.join(sourceDirectory, entry.name),
      path.join(outputDirectory, entry.name),
    )
  )));
  await fs.copyFile(
    path.join(sourceDirectory, 'tint-options.json'),
    path.join(outputDirectory, 'tint-options.json'),
  );

  const sourceImages = path.join(sourceDirectory, 'images');
  const outputImages = path.join(outputDirectory, 'images');
  try {
    await fs.cp(sourceImages, outputImages, { recursive: true, errorOnExist: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function buildSite(sourceDirectory = path.resolve(__dirname, '..'), outputDirectory = path.join(sourceDirectory, 'dist')) {
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await copyPublicFiles(sourceDirectory, outputDirectory);
}

if (require.main === module) {
  buildSite().then(
    () => console.log('Public website files copied to dist/ without server or environment files.'),
    (error) => {
      console.error('Website build failed:', error.message);
      process.exitCode = 1;
    },
  );
}

module.exports = { buildSite, copyPublicFiles };
