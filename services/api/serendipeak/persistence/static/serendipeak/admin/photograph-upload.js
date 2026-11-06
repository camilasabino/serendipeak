"use strict";

// The chosen file is previewed through an object URL, so the preview makes no request.
//
// A file input cannot be filled by a server, so a submission that is refused would make the
// editor choose the file again. The page keeps the chosen file in this browser's IndexedDB
// instead and gives it back when the form comes back refused for another reason. Nothing is
// uploaded or stored on the server before the whole form is valid.
const DATABASE = "serendipeak-admin";
const CHOSEN_FILES = "chosen-photographs";
const KEPT_FOR_MS = 60 * 60 * 1000;

const withStore = (mode, run) =>
  new Promise((resolve) => {
    let opening;
    try {
      opening = indexedDB.open(DATABASE, 1);
    } catch {
      resolve(undefined);
      return;
    }

    opening.onupgradeneeded = () => opening.result.createObjectStore(CHOSEN_FILES);
    opening.onerror = () => resolve(undefined);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction(CHOSEN_FILES, mode);
      const request = run(transaction.objectStore(CHOSEN_FILES));
      transaction.oncomplete = () => {
        database.close();
        resolve(request?.result);
      };
      transaction.onerror = transaction.onabort = () => {
        database.close();
        resolve(undefined);
      };
    };
  });

const keyOf = (input) => `${location.pathname}#${input.name}`;
const remember = (input, file) =>
  withStore("readwrite", (store) => store.put({ file, keptAt: Date.now() }, keyOf(input)));
const forget = (input) => withStore("readwrite", (store) => store.delete(keyOf(input)));
const recall = (input) => withStore("readonly", (store) => store.get(keyOf(input)));

const purgeStale = () =>
  withStore("readwrite", (store) => {
    store.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (Date.now() - cursor.value.keptAt > KEPT_FOR_MS) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
  });

const sibling = (input, suffix) =>
  document.querySelector(`[name="${input.name.replace(/photograph_file$/, suffix)}"]`);

const reviewRow = (input) => sibling(input, "credit_reviewed")?.closest(".form-row");

const sync = (input) => {
  const upload = input.closest(".photograph-upload");
  const selected = upload?.querySelector("[data-photograph-selected]");
  const preview = upload?.querySelector("img[data-photograph-preview]");
  if (!selected || !preview) {
    return;
  }

  if (preview.src.startsWith("blob:")) {
    URL.revokeObjectURL(preview.src);
  }
  const hasFile = input.files.length > 0;
  if (hasFile) {
    preview.src = URL.createObjectURL(input.files[0]);
  } else {
    preview.removeAttribute("src");
  }

  selected.hidden = !hasFile;
  const row = reviewRow(input);
  if (row) {
    row.hidden = !hasFile;
  }
};

// The form came back refused: the admin's error note is there, or the photograph could not be
// stored. A refusal of the file itself shows an error on its own row, and that file is not kept.
const wasRefusedForAnotherReason = (input) =>
  Boolean(
    document.querySelector(".errornote, .messagelist .photograph-not-stored") &&
      !input.closest(".form-row")?.querySelector(".errorlist"),
  );

const restore = async (input) => {
  if (!wasRefusedForAnotherReason(input) || input.files.length > 0) {
    await forget(input);
    return;
  }

  const kept = await recall(input);
  if (!kept || Date.now() - kept.keptAt > KEPT_FOR_MS) {
    await forget(input);
    return;
  }

  const transfer = new DataTransfer();
  transfer.items.add(kept.file);
  input.files = transfer.files;
  sync(input);
};

document.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches("[data-photograph-file]")) {
    return;
  }

  sync(input);
  if (input.files.length > 0) {
    remember(input, input.files[0]);
  } else {
    forget(input);
  }
});

document.addEventListener("click", (event) => {
  const button = event.target;
  if (!(button instanceof Element) || !button.matches("[data-photograph-cancel]")) {
    return;
  }

  const input = button
    .closest(".photograph-upload")
    ?.querySelector("input[data-photograph-file]");
  if (!input) {
    return;
  }

  input.value = "";
  const checkbox = sibling(input, "credit_reviewed");
  if (checkbox) {
    checkbox.checked = false;
  }
  sync(input);
  forget(input);
});

document.addEventListener("DOMContentLoaded", async () => {
  const inputs = document.querySelectorAll("input[data-photograph-file]");
  inputs.forEach(sync);
  await Promise.all([...inputs].map(restore));
  await purgeStale();
});
