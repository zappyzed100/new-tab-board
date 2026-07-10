// offscreen.ts — 予定前アラームのループ音再生(SPEC.md §4.11)。停止はbackground.tsが
// chrome.offscreen.closeDocument()でこのドキュメントごと閉じることで行う。
const audio = document.getElementById("alarm-audio") as HTMLAudioElement | null;
void audio?.play();
