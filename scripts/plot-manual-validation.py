"""Gera figuras das evidências de 18/11; requer matplotlib, sem acesso à AWS."""
import os
import json
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

os.environ.setdefault('MPLCONFIGDIR', str(Path(tempfile.gettempdir()) / 'periferia-matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

root = Path(__file__).resolve().parents[1]
folder = root / 'docs/evidence/manual-validation-20261118'
def read(name):
    return json.loads((folder / name).read_text())
def date(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))
snapshots = [json.loads(line) for line in (folder / 'infra-snapshots.jsonl').read_text().splitlines()]
http = [json.loads(line) for line in (folder / 'http-probe.jsonl').read_text().splitlines()]
metric_file = next((folder / (p + '-metrics.json') for p in ['final', 'settling', 'recovery'] if (folder / (p + '-metrics.json')).exists()))
metrics = {v['Id']: v for v in json.loads(metric_file.read_text())['MetricDataResults']}
fig, axes = plt.subplots(4, 1, figsize=(13, 12), sharex=True, layout='constrained')
fig.suptitle('Periferia · validação manual na AWS · 18/11/2026', fontsize=17)
times = [date(row['at']) for row in snapshots]
for service, label, color in [('periferia-worker', 'Workers executando', '#31688e'), ('periferia-api', 'APIs executando', '#35b779')]:
    values = [next((s['Running'] for s in r.get('services', []) if s['Name'] == service), float('nan')) for r in snapshots]
    axes[0].scatter(times, values, label=label + ' (snapshots)', color=color, s=9)
axes[0].scatter(times, [len([i for i in r.get('asg', {}).get('Instances', []) if i['State'] == 'InService']) for r in snapshots], label='EC2 InService (snapshots)', color='#e68a2e', s=9)
for metric_id, color in [('running', '#31688e'), ('apirunning', '#35b779'), ('hostcount', '#e68a2e')]:
    m = metrics.get(metric_id, {})
    axes[0].plot([datetime.fromtimestamp(t, timezone.utc) for t in m.get('Timestamps', [])], m.get('Values', []), color=color, alpha=.6, linewidth=1)
axes[0].set(ylabel='Quantidade', title='Tasks e hosts: contagens observadas')
axes[0].legend(loc='upper right', ncol=3)

def series(id, ax, **kwargs):
    m = metrics.get(id, {})
    ax.plot([datetime.fromtimestamp(t, timezone.utc) for t in m.get('Timestamps', [])], m.get('Values', []), **kwargs)
series('visible', axes[1], label='Visíveis: média de 60 s', color='#31688e', marker='.')
right = axes[1].twinx()
series('age', right, label='Idade: máximo de 60 s', color='#e68a2e', marker='.')
axes[1].set(ylabel='Mensagens', title='SQS: backlog e idade (métricas aproximadas)')
right.set_ylabel('Idade em segundos')
lines = axes[1].get_lines() + right.get_lines()
axes[1].legend(lines, [line.get_label() for line in lines], loc='upper right')

minutes = defaultdict(list)
for row in http:
    minutes[date(row['at']).replace(second=0, microsecond=0)].append(row)
keys = sorted(minutes)
latencies = []
for minute in keys:
    values = sorted(r['durationMs'] for r in minutes[minute] if r.get('status') == 200)
    latencies.append(values[min(int(len(values) * .95), len(values) - 1)] if values else float('nan'))
axes[2].plot(keys, latencies, color='#31688e', marker='.', label='p95 por minuto: GET /api/state')
failures = [(date(r['at']), r['durationMs']) for r in http if r.get('status') != 200]
if failures:
    axes[2].scatter(*zip(*failures), color='red', marker='x', label='Falha HTTP/transporte')
axes[2].set(ylabel='Milissegundos', title=f'Sonda de persistência: {len(http)} consultas; {len(failures)} falhas')
axes[2].legend(loc='upper right')

series('cpu', axes[3], label='CPU do serviço / reserva', color='#31688e', marker='.')
series('memory', axes[3], label='Memória do serviço / reserva', color='#35b779', marker='.')
axes[3].set(ylabel='Percentual', title='Worker: utilização média do serviço; não representa pico de RSS do host', xlabel='Horário UTC (Brasília = UTC − 3 h)')
axes[3].legend(loc='upper right')
gaps = []
for source, limit in [(http, 30), (snapshots, 120)]:
    for before, after in zip(source, source[1:]):
        left, right_gap = date(before['at']), date(after['at'])
        if (right_gap - left).total_seconds() > limit:
            gaps.append((left, right_gap))
merged = []
for left, right_gap in sorted(gaps):
    if merged and left <= merged[-1][1]:
        merged[-1] = (merged[-1][0], max(merged[-1][1], right_gap))
    else:
        merged.append((left, right_gap))
for ax in axes:
    ax.grid(alpha=.2)
    ax.axvspan(date('2026-11-18T11:40:01Z'), date('2026-11-18T11:46:06Z'), color='#31688e', alpha=.07)
    ax.axvline(date('2026-11-18T11:34:28.647282Z'), color='#666666', linestyle=':', alpha=.7)
    ax.axvline(date('2026-11-18T11:48:03.052Z'), color='#b54646', linestyle=':', alpha=.7)
    for left, right_gap in merged:
        ax.axvspan(left, right_gap, color='#666666', alpha=.12)
axes[-1].xaxis.set_major_formatter(mdates.DateFormatter('%H:%M', tz=timezone.utc))
fig.supxlabel('Azul: publicação de replays · faixa cinza: lacuna de coleta · pontilhado cinza: drenagem · vermelho: vencimento sob falha', fontsize=9)
fig.savefig(folder / 'validacao-manual.png', dpi=160)
fig.savefig(folder / 'validacao-manual.pdf')
axes[-1].set_xlim(date('2026-11-18T11:32:00Z'), date('2026-11-18T12:35:00Z'))
fig.savefig(folder / 'validacao-ciclo-escala.png', dpi=160)
axes[-1].set_xlim(date('2026-11-18T11:32:00Z'), date('2026-11-18T11:57:00Z'))
fig.savefig(folder / 'validacao-detalhe-carga.png', dpi=160)
print('Figuras PNG e PDF geradas a partir dos arquivos de evidência.')
