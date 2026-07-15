export type EqPreset = {
    name: string;
    gains: number[]; // 10 bands
    preamp: number;
    builtin: boolean;
};

export const defaultPresets: EqPreset[] = [
    { name: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, builtin: true },
    { name: "Bass Boost", gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], preamp: -3, builtin: true },
    { name: "Treble Boost", gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6], preamp: -2, builtin: true },
    { name: "Vocal", gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1], preamp: -1, builtin: true },
    { name: "Rock", gains: [5, 4, 2, -1, -2, -1, 2, 3, 4, 4], preamp: -2, builtin: true },
    { name: "Pop", gains: [-1, 2, 4, 4, 2, 0, -1, -1, -1, -1], preamp: -1, builtin: true },
    { name: "Jazz", gains: [3, 2, 1, 2, -2, -2, 0, 1, 2, 3], preamp: -1, builtin: true },
    { name: "Classical", gains: [4, 3, 2, 2, -1, -1, 0, 2, 3, 3], preamp: -1, builtin: true },
    { name: "Electronic", gains: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5], preamp: -2, builtin: true },
    { name: "Acoustic", gains: [4, 4, 3, 1, 2, 1, 2, 3, 3, 2], preamp: -1, builtin: true },
    { name: "Lo-fi", gains: [3, 2, 1, 0, 0, -1, -2, -4, -6, -8], preamp: 0, builtin: true },
];
