import axios from 'axios';
import { load } from 'cheerio';
import { deleteAsync as del } from 'del';
import 'dotenv/config';
import fs from 'fs';
import gulp from 'gulp';
import dom from 'gulp-dom';
import remoteSrc from 'gulp-remote-src';
import path from 'path';

// your external URL:
const WEB_DIR = process.env.WEB_DIR;

if (!WEB_DIR) {
    throw new Error('WEB_DIR environment variable is not defined');
}

const paths = {
    assets: { dest: 'www/' },
    index: { dest: 'www/' }
};

async function clean() {
    await del(['www/**']);
}

async function fetchIndex() {
    try {
        return axios.get(`${WEB_DIR}index.html`)
            .then(res => {
                fs.mkdirSync(paths.index.dest, { recursive: true });
                fs.writeFileSync(path.join(paths.index.dest, 'index.html'), res.data);
            });
    } catch (error) {
        console.error(error);
    }
}

// Download all assets (js, css, fonts, images…)
function copy() {
    const indexHtml = fs.readFileSync(path.join(paths.index.dest, 'index.html'), 'utf8');
    const $ = load(indexHtml);

    const assets = [];

    $('script[src]').each((_, el) => assets.push($(el).attr('src')));
    $('link[rel="stylesheet"]').each((_, el) => assets.push($(el).attr('href')));
    $('img[src]').each((_, el) => assets.push($(el).attr('src')));

    // Separate absolute and relative URLs
    const remoteAssets = assets.filter(file => !file.startsWith('http'));
    const absoluteAssets = assets.filter(file => file.startsWith('http'));

    // Download only relative assets from WEB_DIR
    const relativeDownload = remoteSrc(remoteAssets.map(a => a.replace(/^\//, '')), {
        base: WEB_DIR
    }).pipe(gulp.dest(paths.assets.dest));

    // Download absolute files using axios/fs manually
    const absoluteDownload = Promise.all(
        absoluteAssets.map(async url => {
            try {
                const filename = url.split('/').pop();
                const filepath = path.join(paths.assets.dest, filename);
                const res = await axios.get(url, { responseType: 'arraybuffer' });
                fs.writeFileSync(filepath, res.data);
            } catch (err) {
                console.error('Failed absolute asset:', url);
            }
        })
    );

    return Promise.all([relativeDownload, absoluteDownload]);
}


// Inject CSP, tizen.js, etc.
function modifyIndex() {

    return gulp.src(path.join(paths.index.dest, 'index.html'))
        .pipe(dom(function () {
            const meta = this.createElement('meta');
            meta.setAttribute('http-equiv', 'Content-Security-Policy');
            meta.setAttribute('content', 'default-src * \'self\' \'unsafe-inline\' \'unsafe-eval\' data: gap: file: filesystem: ws: wss:;');
            this.head.appendChild(meta);

            // Search for injected main.bundle
            let apploader = this.querySelector('script[src^=main]');

            if (apploader) {
                console.debug('Found injected main.bundle');
                apploader.setAttribute('defer', '');
            } else {
                // Search for injected apploader
                apploader = this.body.querySelector('script[src*="apploader"]');

                if (apploader) {
                    console.debug('Found injected apploader');
                    apploader.setAttribute('defer', '');
                } else {
                    console.debug('Inject apploader');

                    // inject apploader.js
                    apploader = this.createElement('script');
                    apploader.setAttribute('src', 'scripts/apploader.js');
                    apploader.setAttribute('defer', '');
                    this.body.appendChild(apploader);
                }
            }

            const injectTarget = apploader.parentNode;

            // inject webapis.js
            const webapis = this.createElement('script');
            webapis.setAttribute('src', '$WEBAPIS/webapis/webapis.js');
            injectTarget.insertBefore(webapis, apploader);

            // inject appMode script
            const appMode = this.createElement('script');
            appMode.text = 'window.appMode=\'cordova\';';
            injectTarget.insertBefore(appMode, apploader);

            // inject tizen.js
            const tizen = this.createElement('script');
            tizen.setAttribute('src', '../tizen.js');
            tizen.setAttribute('defer', '');
            injectTarget.insertBefore(tizen, apploader);

            return this;
        }))
        .pipe(gulp.dest(paths.index.dest));
}

// Default build task
const build = gulp.series(
    clean,
    fetchIndex,
    gulp.parallel(copy, modifyIndex)
);

// Export tasks so they can be run individually
export {
    clean, copy, fetchIndex, modifyIndex
};
// Export default task
export default build;
