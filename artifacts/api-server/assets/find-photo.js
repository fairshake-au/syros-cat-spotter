// Find from a photo: one tap, one search (SYC-522).
//
// Plain ES2019, no libraries. Comparing a photo takes several seconds and
// each person has only a few searches a day, so a second tap while the first
// is running must not send a second one. On submit this disables the button,
// says the search is running, and ignores any further submit. With no script
// the form is an ordinary POST, as before.
//
// The page comes back from the server as a new page. If the person returns
// with the back button the browser may restore this page as it was left, so
// "pageshow" puts the button back. If they press Stop or the network drops,
// no page ever arrives, so the button also comes back after 40 seconds (the
// page says a search takes up to half a minute).
(function () {
  "use strict";

  var form = document.querySelector("form.findphoto");
  if (!form) return;
  var button = form.querySelector("button[type=submit]");
  var progress = document.getElementById("find-progress");
  if (!button || !progress) return;

  var label = button.textContent;
  var sent = false;

  function reset() {
    sent = false;
    button.disabled = false;
    button.textContent = label;
    form.removeAttribute("aria-busy");
    progress.hidden = true;
  }

  form.addEventListener("submit", function (e) {
    if (sent) {
      e.preventDefault();
      return;
    }
    sent = true;
    button.disabled = true;
    button.textContent = "Comparing…";
    form.setAttribute("aria-busy", "true");
    progress.hidden = false;
    window.setTimeout(reset, 40000);
  });

  window.addEventListener("pageshow", reset);
})();
