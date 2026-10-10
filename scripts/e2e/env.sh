# Settings for the local sign-in test server (sourced by CI and by hand). Throwaway values:
# this server only ever runs on this computer, for tests.
export GOTRUE_API_HOST=127.0.0.1
export PORT=9999
export API_EXTERNAL_URL=http://127.0.0.1:9999
export GOTRUE_DB_DRIVER=postgres
export GOTRUE_DB_NAMESPACE=auth
export DATABASE_URL="${E2E_AUTH_DATABASE_URL:?set E2E_AUTH_DATABASE_URL}"
export GOTRUE_SITE_URL=http://localhost:4173
export GOTRUE_JWT_SECRET="${E2E_AUTH_JWT_SECRET:?set E2E_AUTH_JWT_SECRET}"
export GOTRUE_JWT_EXP=3600
export GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
export GOTRUE_JWT_ADMIN_ROLES=service_role
export GOTRUE_DISABLE_SIGNUP=true
export GOTRUE_MAILER_AUTOCONFIRM=true
export GOTRUE_EXTERNAL_EMAIL_ENABLED=true
export GOTRUE_MFA_TOTP_ENROLL_ENABLED=true
export GOTRUE_MFA_TOTP_VERIFY_ENABLED=true
export GOTRUE_LOG_LEVEL=warn
