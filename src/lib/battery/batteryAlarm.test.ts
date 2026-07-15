// batteryAlarm.test.ts — decideBatteryAlarm(閾値越え判定)の単体テスト
import { describe, expect, it } from "vitest";
import { decideBatteryAlarm, DEFAULT_BATTERY_THRESHOLDS } from "./batteryAlarm";

describe("decideBatteryAlarm", () => {
  it("初回、45%は50%閾値だけを跨ぐ", () => {
    const r = decideBatteryAlarm(45, []);
    expect(r.toFire).toEqual([50]);
    expect(r.nextFired).toEqual([50]);
  });

  it("一気に15%まで下がれば20%だけ新たに跨ぐ(50%は既発火・10%はまだ未満ではない)", () => {
    const r = decideBatteryAlarm(15, [50]);
    expect(r.toFire).toEqual([20]);
    expect(r.nextFired.sort((a, b) => b - a)).toEqual([50, 20]);
  });

  it("一気に5%まで下がれば20%・10%を両方跨ぐ(50%は既発火なので含まない)", () => {
    const r = decideBatteryAlarm(5, [50]);
    expect(r.toFire).toEqual([20, 10]);
    expect(r.nextFired.sort((a, b) => b - a)).toEqual([50, 20, 10]);
  });

  it("全閾値発火済みのまま下がり続けても何も鳴らさない", () => {
    const r = decideBatteryAlarm(5, [50, 20, 10]);
    expect(r.toFire).toEqual([]);
    expect(r.nextFired.sort((a, b) => b - a)).toEqual([50, 20, 10]);
  });

  it("最高閾値(50%)を上回るまで回復したら発火済み記録をリセットする", () => {
    const r = decideBatteryAlarm(60, [50, 20, 10]);
    expect(r.toFire).toEqual([]);
    expect(r.nextFired).toEqual([]);
  });

  it("リセット後、再び45%まで下がれば50%閾値をまた鳴らす", () => {
    const recovered = decideBatteryAlarm(60, [50, 20, 10]);
    const r = decideBatteryAlarm(45, recovered.nextFired);
    expect(r.toFire).toEqual([50]);
  });

  it("最高閾値未満までしか回復しない場合は発火済み記録を消さない", () => {
    // 50%は既発火。30%まで回復(50%は超えない)→リセットされないので50%は再度鳴らない。
    const r = decideBatteryAlarm(30, [50]);
    expect(r.toFire).toEqual([]);
    expect(r.nextFired).toEqual([50]);
  });

  it("ちょうど閾値と同じ値も「以下」として跨ぐ扱いにする(20%は50%も20%も跨ぐ)", () => {
    const r = decideBatteryAlarm(20, []);
    expect(r.toFire).toEqual([50, 20]);
  });

  it("既定閾値は10/20/50%の降順", () => {
    expect(DEFAULT_BATTERY_THRESHOLDS).toEqual([50, 20, 10]);
  });
});
