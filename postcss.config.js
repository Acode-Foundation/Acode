module.exports = {
    plugins: [
        require('./utils/postcss/colorMixSupports'),
        require('autoprefixer')({})
    ]
};
