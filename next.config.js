const { withExpo } = require('@expo/next-adapter');
const withImages = require('next-images');

module.exports = withExpo(
  withImages({
    projectRoot: __dirname,
  })
);
