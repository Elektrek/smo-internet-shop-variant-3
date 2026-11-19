export class Random {
  constructor(seed = 42) {
    this.state = (Number(seed) >>> 0) || 0x6D2B79F5;
  }

  next() {
    let value = (this.state += 0x6D2B79F5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}

export class ExponentialDistribution {
  constructor(lambda, random) {
    if (!(lambda > 0)) throw new RangeError('lambda должна быть больше нуля');
    this.lambda = lambda;
    this.random = random;
  }

  sample() {
    const u = this.random.next();
    return -Math.log(1 - u) / this.lambda;
  }
}

export class UniformServiceDistribution {
  constructor(minTime, maxTime, random) {
    if (!(minTime > 0) || !(maxTime >= minTime)) {
      throw new RangeError('Некорректные границы равномерного распределения');
    }
    this.minTime = minTime;
    this.maxTime = maxTime;
    this.random = random;
  }

  sample() {
    return this.minTime + (this.maxTime - this.minTime) * this.random.next();
  }
}
