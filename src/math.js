/**
 * Mathe-Formeln: bettet MathJax 3 (SVG-Ausgabe, komplett offline lauffähig)
 * in die Ausgabe ein und wandelt LaTeX-Formeln um – auch in Inhalten, die
 * erst später ins DOM eingefügt werden (z. B. GameMap-Etappen, Course-
 * Presentation-Folien, Question-Set-Seiten). Ersetzt damit das H5P-Add-on
 * "H5P.MathDisplay", das MathJax aus dem Internet nachlädt.
 */
const fs = require('fs');

const MATHJAX_FILE = require.resolve('mathjax/es5/tex-svg-full.js');

/** Delimiter wie bei H5P.MathDisplay/Moodle, aber ohne einzelnes "$"
 *  (zu viele Fehltreffer bei Geldbeträgen). */
const MATH_PATTERN = /\\\(|\\\[|\$\$/;

/** Wird vor MathJax ausgeführt (Konfiguration). */
const CONFIG_SCRIPT = `window.MathJax = {
    tex: {
        inlineMath: [['\\\\(', '\\\\)']],
        displayMath: [['\\\\[', '\\\\]'], ['$$', '$$']],
        processEscapes: true
    },
    svg: { fontCache: 'global' },
    options: {
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code',
            'annotation', 'annotation-xml', 'input', 'select']
    },
    startup: {
        typeset: false,
        ready: function () {
            MathJax.startup.defaultReady();
            MathJax.startup.promise.then(function () {
                if (window.__h5pConverterMath) window.__h5pConverterMath();
            });
        }
    }
};`;

/** Wird nach MathJax ausgeführt: Erst-Umwandlung + Beobachtung des DOM. */
const OBSERVER_SCRIPT = `window.__h5pConverterMath = function () {
    var pattern = ${MATH_PATTERN.toString()};
    var pending = [];
    var timer = null;

    function resizeH5P() {
        try {
            if (window.H5P && H5P.instances) {
                H5P.instances.forEach(function (instance) {
                    if (instance && instance.trigger) instance.trigger('resize');
                });
            }
        } catch (e) { /* ignorieren */ }
    }

    function flush() {
        timer = null;
        var nodes = pending.filter(function (n) { return n && n.isConnected; });
        pending = [];
        // Nur äußerste Knoten umwandeln (verschachtelte sind enthalten)
        nodes = nodes.filter(function (n) {
            return !nodes.some(function (m) { return m !== n && m.contains(n); });
        });
        if (!nodes.length) return;
        MathJax.typesetPromise(nodes).then(resizeH5P).catch(function (e) {
            console.warn('MathJax:', e);
        });
    }

    function schedule(node) {
        if (!node || node.nodeType !== 1) return;
        if (node.closest && node.closest('mjx-container')) return;
        pending.push(node);
        if (!timer) timer = setTimeout(flush, 30);
    }

    function start() {
        new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                if (m.type === 'characterData') {
                    if (pattern.test(m.target.data)) schedule(m.target.parentElement);
                    return;
                }
                for (var i = 0; i < m.addedNodes.length; i++) {
                    var n = m.addedNodes[i];
                    if (n.nodeType === 3) {
                        if (pattern.test(n.data)) schedule(n.parentElement);
                    } else if (n.nodeType === 1 && n.localName !== 'mjx-container' &&
                               pattern.test(n.textContent || '')) {
                        schedule(n);
                    }
                }
            });
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
        schedule(document.body);
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
};`;

let cachedScript = null;

/**
 * Liefert das komplette Skript (Konfiguration + MathJax + Beobachter) als
 * einen String – in einer Datei, damit die Reihenfolge immer stimmt.
 * Für die Einbettung in <script> entschärft.
 */
function buildMathScript() {
    if (!cachedScript) {
        const mathjax = fs
            .readFileSync(MATHJAX_FILE, 'utf8')
            .replace(/<\/script/gi, '<\\/script')
            .replace(/<!--/g, '<\\!--');
        cachedScript = `${CONFIG_SCRIPT}\n${OBSERVER_SCRIPT}\n${mathjax}\n`;
    }
    return cachedScript;
}

/** Sucht rekursiv in allen Texten der Inhaltsparameter nach Formeln. */
function containsMath(value) {
    if (typeof value === 'string') return MATH_PATTERN.test(value);
    if (Array.isArray(value)) return value.some(containsMath);
    if (value && typeof value === 'object') {
        return Object.values(value).some(containsMath);
    }
    return false;
}

/**
 * Entscheidet, ob MathJax eingebettet wird.
 * @param {'auto'|'on'|'off'|undefined} mode
 */
function shouldEmbedMath(mode, parameters, hasMathDisplay) {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return hasMathDisplay || containsMath(parameters);
}

module.exports = {
    buildMathScript,
    containsMath,
    shouldEmbedMath,
    MATHDISPLAY_MACHINE_NAME: 'H5P.MathDisplay'
};
