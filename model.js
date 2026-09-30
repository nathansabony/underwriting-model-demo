// Simplified multifamily underwriting model. Sample inputs only; no real deal data.
const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value) || 0;
const usd = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const pct = (n, d = 1) => (n * 100).toFixed(d) + '%';

function annualDebtService(loan, rate, years) {
  const r = rate / 12, n = years * 12;
  if (r === 0) return loan / years;
  return loan * r / (1 - Math.pow(1 + r, -n)) * 12;
}
function loanBalance(loan, rate, years, afterYears) {
  const r = rate / 12, n = years * 12, k = afterYears * 12;
  if (r === 0) return loan * (1 - k / n);
  const pmt = loan * r / (1 - Math.pow(1 + r, -n));
  return loan * Math.pow(1 + r, k) - pmt * (Math.pow(1 + r, k) - 1) / r;
}
function irr(flows) {
  let lo = -0.99, hi = 1.5;
  const npv = r => flows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0);
  if (npv(lo) * npv(hi) > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

function run() {
  const price = num('price'), closing = num('closing') / 100, units = num('units');
  const rent = num('rent'), vac = num('vacancy') / 100, other = num('other');
  const opexPct = num('opex') / 100, g = num('growth') / 100, eg = num('egrowth') / 100;
  const ltv = num('ltv') / 100, rate = num('rate') / 100, amort = num('amort');
  const exitCap = num('exitcap') / 100, sellCost = num('sellcost') / 100;

  const loan = price * ltv;
  const equity = price * (1 + closing) - loan;
  const ds = annualDebtService(loan, rate, amort);

  const years = [1, 2, 3, 4, 5];
  const rows = years.map(y => {
    const gpr = units * rent * 12 * Math.pow(1 + g, y - 1);
    const vacancy = gpr * vac;
    const otherInc = units * other * 12 * Math.pow(1 + g, y - 1);
    const egi = gpr - vacancy + otherInc;
    const opex = (units * rent * 12 * (1 - vac) + units * other * 12) * opexPct * Math.pow(1 + eg, y - 1);
    const noi = egi - opex;
    return { gpr, vacancy, otherInc, egi, opex, noi, ds, cf: noi - ds };
  });
  const noi6 = rows[4].noi * (1 + g);

  // Metrics
  const cap = rows[0].noi / price, coc = rows[0].cf / equity, dscr = rows[0].noi / ds;

  function scenario(capRate) {
    const sale = noi6 / capRate;
    const net = sale * (1 - sellCost) - loanBalance(loan, rate, amort, 5);
    const flows = [-equity, ...rows.map((r, i) => r.cf + (i === 4 ? net : 0))];
    const total = flows.slice(1).reduce((a, b) => a + b, 0);
    return { capRate, sale, net, em: total / equity, irr: irr(flows) };
  }
  const base = scenario(exitCap);
  const scen = [
    ['Upside', scenario(exitCap - 0.005)],
    ['Base', base],
    ['Downside', scenario(exitCap + 0.005)],
  ];

  const bDscr = num('bdscr'), bIrr = num('birr') / 100;
  setMetric('m-cap', pct(cap, 2), null);
  setMetric('m-coc', pct(coc), coc > 0);
  setMetric('m-dscr', dscr.toFixed(2) + 'x', dscr >= bDscr);
  setMetric('m-irr', isNaN(base.irr) ? 'n/a' : pct(base.irr), base.irr >= bIrr);

  const line = (label, key, cls = '') =>
    `<tr class="${cls}"><td>${label}</td>${rows.map(r => `<td>${usd(key === 'vacancy' || key === 'opex' || key === 'ds' ? -r[key] : r[key])}</td>`).join('')}</tr>`;
  $('pf').innerHTML =
    line('Gross potential rent', 'gpr') + line('Less: vacancy', 'vacancy') + line('Other income', 'otherInc') +
    line('Effective gross income', 'egi', 'total') + line('Operating expenses', 'opex') +
    line('Net operating income', 'noi', 'total') + line('Debt service', 'ds') + line('Cash flow after debt', 'cf', 'total');

  $('exit').innerHTML = scen.map(([name, s]) =>
    `<tr><td>${name}</td><td>${pct(s.capRate, 2)}</td><td>${usd(s.sale)}</td><td>${usd(s.net)}</td><td>${s.em.toFixed(2)}x</td><td>${isNaN(s.irr) ? 'n/a' : pct(s.irr)}</td></tr>`
  ).join('');

  // Refinance check at year 3 (75% LTV of value at exit cap)
  const val3 = rows[2].noi / exitCap;
  const newLoan = val3 * 0.75;
  const payoff = loanBalance(loan, rate, amort, 3);
  const cashOut = newLoan - payoff;
  $('refi').className = 'flag ' + (cashOut > 0 ? 'ok' : 'no');
  $('refi').textContent = cashOut > 0
    ? `Year-3 refinance at 75% LTV could return about ${usd(cashOut)} of equity (${pct(cashOut / equity)} of the initial equity).`
    : `A year-3 refinance at 75% LTV would not generate cash out (shortfall ${usd(-cashOut)}).`;

  const checks = [
    [dscr >= bDscr, `Year-1 DSCR ${dscr.toFixed(2)}x vs. minimum ${bDscr.toFixed(2)}x`],
    [base.irr >= bIrr, `Base-case IRR ${isNaN(base.irr) ? 'n/a' : pct(base.irr)} vs. target ${pct(bIrr)}`],
    [cap >= exitCap - 0.0075, `Going-in cap ${pct(cap, 2)} is within 75 bps of exit cap ${pct(exitCap, 2)}`],
    [coc > 0, `Positive year-1 cash flow after debt service (${usd(rows[0].cf)})`],
  ];
  $('checks').innerHTML = checks.map(([ok, t]) => `<p class="flag ${ok ? 'ok' : 'no'}">${t}</p>`).join('');
}
function setMetric(id, text, good) {
  const el = $(id); el.querySelector('.v').textContent = text;
  el.classList.remove('good', 'bad');
  if (good === true) el.classList.add('good'); else if (good === false) el.classList.add('bad');
}
document.querySelectorAll('#inputs input').forEach(i => i.addEventListener('input', run));
run();
