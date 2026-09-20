// Dynamic Expo config: everything in app.json, plus the one setting that depends on where the
// web build is hosted. GitHub Pages serves a project site under /<repo-name>/, so the workflow
// sets EXPO_BASE_URL=/Itera-Connect; locally (npm run web) it is unset and the app lives at /.
module.exports = ({ config }) => {
  const baseUrl = process.env.EXPO_BASE_URL;
  if (!baseUrl) return config;
  return { ...config, experiments: { ...(config.experiments ?? {}), baseUrl } };
};
