import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { DEFAULT_CONFIG, validateConfig } from './core/config.js';
import { SimulationEngine } from './core/simulation-engine.js';
import { ConsoleView } from './console/console-view.js';

const rl = readline.createInterface({ input, output });
const view = new ConsoleView();
const inputQueue = [];
let pendingInput = null;
let inputClosed = false;

rl.on('line', line => {
  if (pendingInput) {
    const resolve = pendingInput;
    pendingInput = null;
    resolve(line);
  } else {
    inputQueue.push(line);
  }
});
rl.on('close', () => {
  inputClosed = true;
  if (pendingInput) {
    const resolve = pendingInput;
    pendingInput = null;
    resolve(null);
  }
});

function ask(prompt) {
  output.write(prompt);
  if (inputQueue.length) return Promise.resolve(inputQueue.shift());
  if (inputClosed) return Promise.resolve(null);
  return new Promise(resolve => { pendingInput = resolve; });
}
let config = { ...DEFAULT_CONFIG };

function readNumber(value, current) {
  if (value === null || value.trim() === '') return current;
  const normalized = value.trim().replace(',', '.');
  return Number(normalized);
}

async function askNumber(prompt, current) {
  return readNumber(await ask(prompt), current);
}

async function changeConfig() {
  console.log('\nПАРАМЕТРЫ МОДЕЛИ');
  const next = {
    sourceCount: await askNumber(`Количество источников [${config.sourceCount}]: `, config.sourceCount),
    lambda: await askNumber(`Интенсивность λ каждого источника [${config.lambda}]: `, config.lambda),
    workerCount: await askNumber(`Количество приборов [${config.workerCount}]: `, config.workerCount),
    bufferCapacity: await askNumber(`Ёмкость буфера [${config.bufferCapacity}]: `, config.bufferCapacity),
    serviceMin: await askNumber(`Минимальное время обслуживания [${config.serviceMin}]: `, config.serviceMin),
    serviceMax: await askNumber(`Максимальное время обслуживания [${config.serviceMax}]: `, config.serviceMax),
    requestLimit: await askNumber(`Количество генерируемых заявок N [${config.requestLimit}]: `, config.requestLimit),
    seed: await askNumber(`Начальное значение генератора случайных чисел [${config.seed}]: `, config.seed),
  };
  const checked = validateConfig(next);
  if (!checked.valid) {
    console.log('\nОшибки параметров:');
    for (const error of checked.errors) console.log(`- ${error}`);
    return;
  }
  config = checked.config;
  console.log('\nПараметры сохранены.');
}

async function runStepByStep() {
  const engine = new SimulationEngine(config);
  let stepNumber = 0;
  let snapshot = engine.initialize();

  while (true) {
    if (process.stdout.isTTY) console.clear();
    view.printStep(snapshot, stepNumber);
    if (snapshot.finished) break;

    const rawAnswer = await ask('Enter — следующее событие; q — вернуться в меню: ');
    if (rawAnswer === null) return;
    const answer = rawAnswer.trim().toLowerCase();
    if (answer === 'q' || answer === 'й') return;

    snapshot = engine.processNextEvent();
    if (!snapshot) break;
    stepNumber += 1;
  }
  await ask('\nНажмите Enter, чтобы вернуться в меню...');
}

function runAutomatically() {
  const engine = new SimulationEngine(config);
  const results = engine.runToEnd();
  view.printFinalTables(results);
}

function printMenu() {
  console.log('\nСИСТЕМА ОБРАБОТКИ ЗАПРОСОВ ПОИСКА ТОВАРОВ ИНТЕРНЕТ-МАГАЗИНА');
  console.log('Шрамко Максим Кириллович · группа 5130904/40101 · вариант 3');
  console.log('-'.repeat(108));
  console.log(`Источники: ${config.sourceCount} · λ: ${config.lambda} · Приборы: ${config.workerCount} · Буфер: ${config.bufferCapacity}`);
  console.log(`Обслуживание: U(${config.serviceMin}, ${config.serviceMax}) · N: ${config.requestLimit} · Seed: ${config.seed}`);
  console.log('\n1 — Пошаговый режим (ОД3)');
  console.log('2 — Автоматический режим (ОР1)');
  console.log('3 — Изменить параметры');
  console.log('0 — Выход');
}

try {
  while (true) {
    printMenu();
    const rawChoice = await ask('\nВыберите режим: ');
    if (rawChoice === null) break;
    const choice = rawChoice.trim();
    if (choice === '0') break;
    if (choice === '1') {
      await runStepByStep();
    } else if (choice === '2') {
      runAutomatically();
      await ask('\nНажмите Enter, чтобы вернуться в меню...');
    } else if (choice === '3') {
      await changeConfig();
    } else {
      console.log('Неизвестная команда. Выберите 0, 1, 2 или 3.');
    }
  }
} catch (error) {
  console.error(`\nОшибка выполнения: ${error.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
