"""Disposable real PostgreSQL verification; existing Ubuntu cache only, never an application DB."""
import pathlib,subprocess,os,socket,tempfile,shutil,time,json,sys
root=pathlib.Path(__file__).resolve().parents[2]
evidence=root/'g40/evidence';evidence.mkdir(parents=True,exist_ok=True)
assert sys.platform.startswith('linux') and os.geteuid()!=0,'RUN_AS_NORMAL_UBUNTU_USER_WITHOUT_SUDO'
prefix=pathlib.Path.home()/'.cache/earnpatch-g39-postgres/16.15-0ubuntu0.24.04.1/unpacked'
bindir=prefix/'usr/lib/postgresql/16/bin'
assert (bindir/'postgres').is_file(),'EXISTING_CACHED_POSTGRES_REQUIRED: '+str(bindir)
node=shutil.which('node')
if not node:
 candidates=sorted((pathlib.Path.home()/'.nvm/versions/node').glob('v*/bin/node'))
 node=next((str(p) for p in reversed(candidates) if int(p.parent.parent.name[1:].split('.')[0])>=22),None)
assert node,'EXISTING_NODE_22_OR_NEWER_REQUIRED'
node_version=subprocess.check_output([node,'--version'],text=True).strip()
assert int(node_version[1:].split('.')[0])>=22,'NODE_22_OR_NEWER_REQUIRED'
assert shutil.which('openssl'),'EXISTING_OPENSSL_REQUIRED'
assert (root/'g40/node_modules/pg/package.json').is_file() or (root/'node_modules/pg/package.json').is_file(),'INSTALLED_PG_DRIVER_REQUIRED'
env=dict(os.environ,LD_LIBRARY_PATH=str(prefix/'usr/lib/x86_64-linux-gnu'),PATH=str(pathlib.Path(node).parent)+':'+str(bindir)+':'+os.environ['PATH'])
version=subprocess.check_output([str(bindir/'postgres'),'--version'],env=env,text=True).strip()
assert 'PostgreSQL) 16.15 ' in version,'EXPECTED_POSTGRES_16_15_REQUIRED'
dependencies=subprocess.check_output(['ldd',str(bindir/'postgres')],env=env,text=True)
assert 'not found' not in dependencies,'CACHED_POSTGRES_LIBRARY_MISSING'
print('G40_WORKSPACE='+str(root),flush=True)
print('G40_POSTGRES='+version,flush=True)
print('G40_NODE='+node_version,flush=True)
work=pathlib.Path(tempfile.mkdtemp(prefix='earnpatch-g40-postgres-'));data=work/'database';server=None;log=None
try:
 init=subprocess.run([str(bindir/'initdb'),'-D',str(data),'-L',str(prefix/'usr/share/postgresql/16'),'-U','g40_local','--auth-local=trust','--auth-host=trust','--no-locale','--encoding=UTF8'],env=env,capture_output=True,text=True,timeout=30)
 (evidence/'POSTGRES_INIT.log').write_text(init.stdout+init.stderr)
 assert init.returncode==0,'DISPOSABLE_INITDB_FAILED_SEE_POSTGRES_INIT_LOG'
 with socket.socket() as probe:
  probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
 log=(work/'postgres.log').open('w')
 server=subprocess.Popen([str(bindir/'postgres'),'-D',str(data),'-h','127.0.0.1','-p',str(port),'-k',str(work),'-c','shared_buffers=16MB','-c','max_connections=12','-c','jit=off'],env=env,stdout=log,stderr=log)
 for _ in range(80):
  assert server.poll() is None,'DISPOSABLE_POSTGRES_START_FAILED'
  if subprocess.run([str(bindir/'pg_isready'),'-h','127.0.0.1','-p',str(port)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('DISPOSABLE_POSTGRES_NOT_READY')
 subprocess.run([str(bindir/'createdb'),'-h','127.0.0.1','-p',str(port),'-U','g40_local','g40_engineering'],env=env,check=True,timeout=20)
 env.update(G40_TEST_DATABASE_URL='postgres://g40_local@127.0.0.1:'+str(port)+'/g40_engineering',G40_BROWSER='0')
 result=subprocess.run([node,'g40/tests/run-production.mjs'],cwd=root,env=env,capture_output=True,text=True,timeout=150)
 (evidence/'POSTGRES_TEST.stdout.log').write_text(result.stdout)
 (evidence/'POSTGRES_TEST.stderr.log').write_text(result.stderr)
 print(result.stdout,end='',flush=True)
 if result.stderr:print(result.stderr,file=sys.stderr,end='',flush=True)
 assert result.returncode==0,'G40_REAL_POSTGRES_INTEGRATION_FAILED'
 report=json.loads((evidence/'PRODUCTION_POSTGRES.json').read_text())
 assert report['status']=='PASS' and report['database']=='REAL_POSTGRESQL' and report['postgres_observation']['raw_csv_persisted'] is False
 report.update(postgres_version=version,node_version=node_version,local_loopback_test_auth_only=True,existing_databases_modified=False,system_installation=False)
 (evidence/'PRODUCTION_POSTGRES.json').write_text(json.dumps(report,indent=2))
 print('G40_REAL_POSTGRES_TEST=PASS',flush=True)
finally:
 if server:
  server.terminate()
  try:server.wait(timeout=10)
  except subprocess.TimeoutExpired:server.kill();server.wait()
 if log:log.close()
 if (work/'postgres.log').exists():shutil.copyfile(work/'postgres.log',evidence/'POSTGRES_SERVER.log')
 assert work.parent==pathlib.Path(tempfile.gettempdir()) and work.name.startswith('earnpatch-g40-postgres-')
 shutil.rmtree(work)
 print('G40_DISPOSABLE_DATABASE_CLEANED=YES',flush=True)
