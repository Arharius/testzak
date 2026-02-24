.PHONY: test autodetect-matrix deep-checks e2e deploy-pythonanywhere backup backend-smoke release-guard react-build

test: autodetect-matrix deep-checks

autodetect-matrix:
	node tests/autodetect_matrix.cjs

deep-checks:
	node tests/deep_checks.cjs

e2e:
	bash tests/run_e2e.sh

deploy-pythonanywhere:
	bash scripts/deploy_pythonanywhere.sh

backup:
	bash scripts/backup_project.sh

backend-smoke:
	bash scripts/backend_smoke.sh

react-build:
	cd frontend-react && npm run build

release-guard:
	bash scripts/release_guard.sh
