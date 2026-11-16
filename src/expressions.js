// Named faces built from eye/mouth parameters (the firmware has no "emotion" JSON).
// Units: x/y -100..100, rotation 0.1° (-1800..1800), weight 0..100, size -100..100.
export const EXPRESSIONS = {
  neutral: { leftEye: { weight: 100, size: 0, rotation: 0 }, rightEye: { weight: 100, size: 0, rotation: 0 }, mouth: { weight: 0, rotation: 0 } },
  happy:   { leftEye: { weight: 70, size: 10, rotation: 0 }, rightEye: { weight: 70, size: 10, rotation: 0 }, mouth: { weight: 60, rotation: 0 } },
  sleepy:  { leftEye: { weight: 20, size: 0, rotation: 0 }, rightEye: { weight: 20, size: 0, rotation: 0 }, mouth: { weight: 0, rotation: 0 } },
  surprised: { leftEye: { weight: 100, size: 40, rotation: 0 }, rightEye: { weight: 100, size: 40, rotation: 0 }, mouth: { weight: 90, rotation: 0 } },
  wink:    { leftEye: { weight: 100, size: 0, rotation: 0 }, rightEye: { weight: 0, size: 0, rotation: 0 }, mouth: { weight: 30, rotation: 0 } },
  sad:     { leftEye: { weight: 60, size: -10, rotation: -150 }, rightEye: { weight: 60, size: -10, rotation: 150 }, mouth: { weight: 0, rotation: 0 } },
};
