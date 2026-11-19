"""Empacota um checkout limpo, com histórico Git e checksums, fora do projeto.

Uso: python3 scripts/package-delivery.py /diretorio/da/entrega
Não publica nem envia arquivos ao professor.
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
destination = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else None
if destination is None or destination == root or root in destination.parents:
    raise SystemExit('Informe um diretório de saída fora do projeto.')

def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])

if Path(git('rev-parse', '--show-toplevel').decode().strip()).resolve() != root:
    raise SystemExit('A raiz Git precisa ser a raiz deste projeto.')
if git('status', '--porcelain').strip():
    raise SystemExit('Registre a versão revisada em Git antes de empacotar.')

files = [Path(p.decode()) for p in git('ls-files', '-z').split(b'\0') if p]
for relative in files:
    path = root / relative
    forbidden = any(part in {'.git', '.terraform', 'node_modules', '__pycache__'} for part in relative.parts)
    forbidden |= path.name.startswith('.env') and path.name != '.env.example'
    forbidden |= bool(re.search(r'\.tf(?:state|plan|vars)(?:\.|$)', path.name))
    if forbidden or path.is_symlink() or root not in path.resolve().parents:
        raise SystemExit(f'Arquivo impróprio para entrega: {relative}')
    data = path.read_bytes()
    if re.search(rb'(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-(?:proj-|svcacct-)[A-Za-z0-9_-]{24,}', data):
        raise SystemExit(f'Possível credencial em {relative}; revisar sem imprimir o valor.')

destination.mkdir(parents=True, exist_ok=True)
archive = destination / 'periferia-source.zip'
bundle = destination / 'periferia-history.bundle'
report = destination / 'relatorio-tecnico.pdf'
if archive.exists() or bundle.exists() or report.exists():
    raise SystemExit('Use uma pasta nova para preservar a entrega anterior.')
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
    for relative in sorted(files):
        output.write(root / relative, Path('periferia') / relative)
subprocess.run(['git', '-C', str(root), 'bundle', 'create', str(bundle), '--all'], check=True)
subprocess.run(['git', '-C', str(root), 'bundle', 'verify', str(bundle)], check=True, capture_output=True)
artifacts = [archive, bundle]
source_report = root / 'output/pdf/relatorio-tecnico.pdf'
if source_report.is_file():
    shutil.copyfile(source_report, report)
    artifacts.append(report)
manifest = {
    'commit': git('rev-parse', 'HEAD').decode().strip(),
    'sourceFileCount': len(files),
    'files': {p.name: {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in artifacts},
    'entrypoint': 'periferia/README-ENTREGA.md',
    'note': 'Pacote local. A geração não comprova implantação nem envia material ao professor.',
}
(destination / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print(json.dumps(manifest, ensure_ascii=False))
