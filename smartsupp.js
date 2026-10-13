var _smartsupp = window._smartsupp || {};
_smartsupp.key = '9ccc24f88b52634cd002291e2529e4707860de74';
window._smartsupp = _smartsupp;

window.smartsupp || (function (document) {
  var script;
  var firstScript;
  var smartsupp = window.smartsupp = function () {
    smartsupp._.push(arguments);
  };

  smartsupp._ = [];
  firstScript = document.getElementsByTagName('script')[0];
  script = document.createElement('script');
  script.type = 'text/javascript';
  script.charset = 'utf-8';
  script.async = true;
  script.src = 'https://www.smartsuppchat.com/loader.js?';
  firstScript.parentNode.insertBefore(script, firstScript);
})(document);
