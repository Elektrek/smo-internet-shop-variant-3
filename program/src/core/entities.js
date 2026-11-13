import { ExponentialDistribution } from './random.js';

export const RequestStatus = Object.freeze({
  GENERATED: 'GENERATED',
  BUFFERED: 'BUFFERED',
  IN_SERVICE: 'IN_SERVICE',
  COMPLETED: 'COMPLETED',
  EVICTED: 'EVICTED',
});

const SAMPLE_QUERIES = [
  'кроссовки Nike размер 42',
  'смартфон 256 ГБ',
  'ноутбук для учёбы',
  'беспроводные наушники',
  'кофемашина с капучинатором',
  'куртка зимняя мужская',
  'фильтр по цене и рейтингу',
];

export class Request {
  constructor({ id, displayId = id, sequenceId, sourceId, queryText, filters, generatedAt }) {
    this.id = Number(id);
    this.displayId = String(displayId);
    this.sequenceId = sequenceId;
    this.sourceId = sourceId;
    this.queryText = queryText;
    this.filters = filters;
    this.generatedAt = generatedAt;
    this.enqueuedAt = null;
    this.serviceStartedAt = null;
    this.completedAt = null;
    this.serviceTime = null;
    this.status = RequestStatus.GENERATED;
  }

  markBuffered(now) {
    if (this.status !== RequestStatus.GENERATED) throw new Error(`Нельзя поместить заявку ${this.id} в буфер из статуса ${this.status}`);
    this.enqueuedAt = now;
    this.status = RequestStatus.BUFFERED;
  }

  markInService(now) {
    if (this.status !== RequestStatus.BUFFERED) throw new Error(`Нельзя начать обслуживание заявки ${this.id} из статуса ${this.status}`);
    this.serviceStartedAt = now;
    this.status = RequestStatus.IN_SERVICE;
  }

  markCompleted(now) {
    if (this.status !== RequestStatus.IN_SERVICE) throw new Error(`Нельзя завершить заявку ${this.id} из статуса ${this.status}`);
    this.completedAt = now;
    this.status = RequestStatus.COMPLETED;
  }

  markEvicted() {
    if (this.status !== RequestStatus.BUFFERED) throw new Error(`Можно вытеснить только ожидающую заявку: ${this.id}`);
    this.status = RequestStatus.EVICTED;
  }

  getWaitTime() {
    if (this.serviceStartedAt === null || this.enqueuedAt === null) return null;
    return this.serviceStartedAt - this.enqueuedAt;
  }

  getServiceTime() {
    if (this.serviceTime !== null) return this.serviceTime;
    if (this.completedAt === null || this.serviceStartedAt === null) return null;
    return this.completedAt - this.serviceStartedAt;
  }

  getSojournTime() {
    if (this.completedAt === null) return null;
    return this.completedAt - this.generatedAt;
  }
}

export class Source {
  constructor({ id, displayName, lambda, random }) {
    this.id = id;
    this.displayName = displayName;
    this.interarrival = new ExponentialDistribution(lambda, random);
    this.lambda = lambda;
    this.nextRequestId = 1;
    this.nextArrivalTime = null;
    this.generatedCount = 0;
  }

  generateRequest(now, sequenceId) {
    const localId = this.nextRequestId++;
    this.generatedCount += 1;
    const queryText = SAMPLE_QUERIES[(sequenceId - 1) % SAMPLE_QUERIES.length];
    const filters = { category: 'демонстрационная', sort: 'relevance' };
    return new Request({
      id: sequenceId,
      displayId: `${this.id}-${localId}`,
      sequenceId,
      sourceId: this.id,
      queryText,
      filters: new Map(Object.entries(filters)),
      generatedAt: now,
    });
  }

  sampleNextArrival(now) {
    this.nextArrivalTime = now + this.interarrival.sample();
    return this.nextArrivalTime;
  }
}
