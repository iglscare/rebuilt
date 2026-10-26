/**
 * REBUILT — Phase 1: Authentication Flow Analyzer & Failure Diagnostics Test Suite
 * 
 * Verifies all 6 mandatory test cases plus Instagram clone diagnostic scenario:
 * - TEST 1: Invalid credentials -> AUTH_REJECTED (Layer: TARGET_AUTHENTICATION)
 * - TEST 2: Network unavailable / CORS -> AUTH_NETWORK_FAILED (Layer: COMMUNICATION_LAYER)
 * - TEST 3: Login request succeeds (200 OK) but local authenticated state is missing -> AUTH_SESSION_NOT_ESTABLISHED (Layer: SESSION_HANDLING)
 * - TEST 4: Redirect occurs but callback fails -> AUTH_REDIRECT_FAILED (Layer: COMMUNICATION_LAYER)
 * - TEST 5: Target requires additional authentication challenge (MFA / CAPTCHA / checkpoint) -> AUTH_CHALLENGE / AUTH_MFA_REQUIRED / AUTH_CAPTCHA_REQUIRED
 * - TEST 6: Successful login against authorized test application -> AUTH_SUCCESS
 * - TEST 7: Instagram web clone test scenario -> Diagnoses challenge/unsupported security mechanism without attempting bypass
 * - TEST 8: Strict redaction verification -> Asserts passwords, tokens, and cookies are never stored
 * - TEST 9: Diagnostic Panel formatting -> Checklist and chronological timeline readouts
 */

const assert = require('assert');
const {
  AuthenticationFlowObserver,
  AuthDiagnosticsEngine,
  AUTH_CLASSIFICATION,
  FIRST_FAILURE,
  FAILURE_LAYER,
  EVENT_TYPES
} = require('../src/auth');

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, fn) {
  process.stdout.write(`  Testing: ${name} ... `);
  try {
    await fn();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.log('✗ FAILED');
    console.error(`    Error: ${err.message}`);
    testsFailed++;
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('  ⚡ REBUILT — PHASE 1 AUTH FLOW ANALYZER TESTS       ');
  console.log('======================================================\n');

  // TEST 1: Invalid credentials -> AUTH_REJECTED
  await runTest('TEST 1: Invalid credentials -> AUTH_REJECTED (TARGET_AUTHENTICATION)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'test_clone_invalid_creds';

    // 1. Form detected
    observer.recordFormDetected(cloneId, {
      detected: true,
      hasUsername: true,
      hasPassword: true,
      hasSubmit: true
    });

    // 2. User submits login
    observer.recordLoginAction(cloneId, { trigger: 'button_click' });

    // 3. Network request started to target login endpoint
    observer.recordRequestStarted(cloneId, {
      method: 'POST',
      url: 'https://auth.example.com/api/login',
      resourceType: 'fetch'
    });

    // 4. Target responds 401 Unauthorized
    observer.recordResponse(cloneId, {
      status: 401,
      statusText: 'Unauthorized',
      duration: 180,
      headers: { 'content-type': 'application/json' },
      errorSnippet: 'Invalid username or password'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId),
      context: { targetOrigin: 'https://auth.example.com' }
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.AUTH_REJECTED);
    assert.strictEqual(report.failureLayer, FAILURE_LAYER.TARGET_AUTHENTICATION);
    assert.strictEqual(report.checklist.formDetected, true);
    assert.strictEqual(report.checklist.loginActionDetected, true);
    assert.strictEqual(report.checklist.requestGenerated, true);
    assert.strictEqual(report.checklist.targetResponded, true);
    assert.strictEqual(report.checklist.httpStatus, 401);
    assert.strictEqual(report.checklist.sessionEstablished, false);
    assert.strictEqual(report.checklist.authenticatedUi, false);
  });

  // TEST 2: Network unavailable -> AUTH_NETWORK_FAILED
  await runTest('TEST 2: Network unavailable / transport error -> AUTH_NETWORK_FAILED (COMMUNICATION_LAYER)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'test_clone_network_fail';

    observer.recordFormDetected(cloneId, { hasUsername: true, hasPassword: true, hasSubmit: true });
    observer.recordLoginAction(cloneId, { trigger: 'form_submit' });
    observer.recordRequestStarted(cloneId, {
      method: 'POST',
      url: 'https://auth.example.com/api/login'
    });

    // Network error (DNS resolution failure or connection refused)
    observer.recordNetworkError(cloneId, {
      errorType: 'CONNECTION_FAILURE',
      message: 'getaddrinfo ENOTFOUND auth.example.com',
      url: 'https://auth.example.com/api/login'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.AUTH_NETWORK_FAILED);
    assert.strictEqual(report.failureLayer, FAILURE_LAYER.COMMUNICATION_LAYER);
    assert.strictEqual(report.checklist.requestGenerated, true);
    assert.strictEqual(report.checklist.targetResponded, false);
    assert.strictEqual(report.checklist.httpStatus, 'N/A');
  });

  // TEST 2B: CORS policy error -> AUTH_CORS_FAILED
  await runTest('TEST 2B: Browser CORS blocking -> AUTH_CORS_FAILED (COMMUNICATION_LAYER)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'test_clone_cors_fail';

    observer.recordFormDetected(cloneId, { hasUsername: true, hasPassword: true });
    observer.recordLoginAction(cloneId, { trigger: 'button_click' });
    observer.recordRequestStarted(cloneId, {
      method: 'POST',
      url: 'https://remote.example.com/login'
    });
    observer.recordNetworkError(cloneId, {
      errorType: 'CORS_FAILURE',
      message: 'Failed to fetch: No Access-Control-Allow-Origin header present'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.AUTH_CORS_FAILED);
    assert.strictEqual(report.failureLayer, FAILURE_LAYER.COMMUNICATION_LAYER);
  });

  // TEST 3: Login request succeeds but local authenticated state is missing -> AUTH_SESSION_NOT_ESTABLISHED
  await runTest('TEST 3: Target returns 200 OK but local state missing -> AUTH_SESSION_NOT_ESTABLISHED (SESSION_HANDLING)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'test_clone_session_missing';

    observer.recordFormDetected(cloneId, { hasUsername: true, hasPassword: true, hasSubmit: true });
    observer.recordLoginAction(cloneId, { trigger: 'button_click' });
    observer.recordRequestStarted(cloneId, {
      method: 'POST',
      url: 'https://app.example.com/api/v1/auth/login'
    });
    // Target responded 200 OK with session token
    observer.recordResponse(cloneId, {
      status: 200,
      statusText: 'OK',
      duration: 120
    });

    // But no local session state was established (form didn't disappear, no dashboard, no logout control)
    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.AUTH_SESSION_NOT_ESTABLISHED);
    assert.strictEqual(report.failureLayer, FAILURE_LAYER.SESSION_HANDLING);
    assert.strictEqual(report.checklist.targetResponded, true);
    assert.strictEqual(report.checklist.httpStatus, 200);
    assert.strictEqual(report.checklist.sessionEstablished, false);
    assert.strictEqual(report.checklist.authenticatedUi, false);
    assert(report.summary.includes('resulting authenticated state was not established locally'));
  });

  // TEST 4: Redirect occurs but callback fails -> AUTH_REDIRECT_FAILED
  await runTest('TEST 4: Redirect chain fails midway -> AUTH_REDIRECT_FAILED', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'test_clone_redirect_fail';

    observer.recordFormDetected(cloneId, { hasUsername: true, hasPassword: true });
    observer.recordLoginAction(cloneId, { trigger: 'form_submit' });
    observer.recordRequestStarted(cloneId, { method: 'POST', url: 'https://idp.example.com/login' });
    observer.recordRedirect(cloneId, {
      originalUrl: 'https://idp.example.com/login',
      redirectUrl: 'https://cloned.app/callback?error=invalid_grant',
      status: 302,
      completed: false
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.AUTH_REDIRECT_FAILED);
    assert.strictEqual(report.failureLayer, FAILURE_LAYER.COMMUNICATION_LAYER);
    assert.strictEqual(report.checklist.redirectDetected, true);
  });

  // TEST 5: Target requires an additional authentication challenge (MFA / CAPTCHA) -> AUTH_CHALLENGE / AUTH_MFA_REQUIRED
  await runTest('TEST 5: Target demands MFA/2FA challenge -> AUTH_MFA_REQUIRED (TARGET_AUTHENTICATION)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'test_clone_mfa_challenge';

    observer.recordFormDetected(cloneId, { hasUsername: true, hasPassword: true });
    observer.recordLoginAction(cloneId, { trigger: 'button_click' });
    observer.recordRequestStarted(cloneId, { method: 'POST', url: 'https://auth.company.com/login' });
    observer.recordResponse(cloneId, { status: 200, isChallenge: true, challengeType: 'MFA' });
    observer.recordChallenge(cloneId, {
      challengeType: 'MFA',
      description: 'Two-factor authentication code required'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.AUTH_MFA_REQUIRED);
    assert.strictEqual(report.failureLayer, FAILURE_LAYER.TARGET_AUTHENTICATION);
  });

  // TEST 5B: Target demands interactive CAPTCHA -> AUTH_CAPTCHA_REQUIRED
  await runTest('TEST 5B: Target demands CAPTCHA challenge -> AUTH_CAPTCHA_REQUIRED', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'test_clone_captcha';

    observer.recordFormDetected(cloneId, { hasUsername: true, hasPassword: true });
    observer.recordLoginAction(cloneId, { trigger: 'button_click' });
    observer.recordRequestStarted(cloneId, { method: 'POST', url: 'https://service.com/login' });
    observer.recordChallenge(cloneId, {
      challengeType: 'CAPTCHA',
      description: 'Cloudflare Turnstile / reCAPTCHA challenge detected.'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.AUTH_CAPTCHA_REQUIRED);
    assert.strictEqual(report.failureLayer, FAILURE_LAYER.TARGET_AUTHENTICATION);
  });

  // TEST 6: Successful login against an authorized test application -> AUTH_SUCCESS
  await runTest('TEST 6: Successful login with authenticated state -> AUTH_SUCCESS', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'test_clone_success';

    observer.recordFormDetected(cloneId, { hasUsername: true, hasPassword: true, hasSubmit: true });
    observer.recordLoginAction(cloneId, { trigger: 'button_click' });
    observer.recordRequestStarted(cloneId, { method: 'POST', url: 'https://test-app.com/api/login' });
    observer.recordResponse(cloneId, { status: 200, duration: 150 });
    observer.recordSessionStateChange(cloneId, {
      previousRoute: '/login',
      currentRoute: '/dashboard',
      dashboardVisible: true,
      logoutControlFound: true,
      authenticatedState: true
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.AUTH_SUCCESS);
    assert.strictEqual(report.failureLayer, FAILURE_LAYER.UNKNOWN); // No failure
    assert.strictEqual(report.checklist.formDetected, true);
    assert.strictEqual(report.checklist.loginActionDetected, true);
    assert.strictEqual(report.checklist.requestGenerated, true);
    assert.strictEqual(report.checklist.targetResponded, true);
    assert.strictEqual(report.checklist.sessionEstablished, true);
    assert.strictEqual(report.checklist.authenticatedUi, true);
  });

  // TEST 7: Instagram test scenario (Diagnosing why cloned Instagram login fails)
  await runTest('TEST 7: Instagram web clone test scenario -> Diagnoses challenge/unsupported telemetry without bypass', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'instagram_web_clone';

    // 1. Cloned Instagram login form detected
    observer.recordFormDetected(cloneId, {
      detected: true,
      hasUsername: true,
      hasPassword: true,
      hasSubmit: true,
      action: 'https://www.instagram.com/api/v1/web/accounts/login/ajax/'
    });

    // 2. User clicked "Log in"
    observer.recordLoginAction(cloneId, { trigger: 'button_click', submitterType: 'button' });

    // 3. Instagram AJAX request started
    observer.recordRequestStarted(cloneId, {
      method: 'POST',
      url: 'https://www.instagram.com/api/v1/web/accounts/login/ajax/',
      resourceType: 'fetch'
    });

    // 4. Target responds with checkpoint challenge or requires unsupported client telemetry
    observer.recordResponse(cloneId, {
      status: 400,
      statusText: 'Bad Request',
      duration: 210,
      headers: { 'content-type': 'application/json' },
      isChallenge: true,
      challengeType: 'INSTAGRAM_CHECKPOINT',
      errorSnippet: '{"message": "checkpoint_required", "checkpoint_url": "/challenge/", "status": "fail"}'
    });

    observer.recordChallenge(cloneId, {
      challengeType: 'INSTAGRAM_CHECKPOINT',
      provider: 'instagram_security',
      description: 'Instagram checkpoint challenge required (/challenge/). Cloned environment does not defeat security checks.'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId),
      context: { targetOrigin: 'https://www.instagram.com' }
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.AUTH_UNSUPPORTED);
    assert.strictEqual(report.failureLayer, FAILURE_LAYER.TARGET_AUTHENTICATION);
    assert.strictEqual(report.checklist.formDetected, true);
    assert.strictEqual(report.checklist.loginActionDetected, true);
    assert.strictEqual(report.checklist.requestGenerated, true);
    assert.strictEqual(report.checklist.targetResponded, true);
    assert.strictEqual(report.checklist.httpStatus, 400);
    assert.strictEqual(report.checklist.sessionEstablished, false);
    assert(report.summary.includes('proprietary client device fingerprinting'));
  });

  // TEST 8: Strict safe logging & automatic redaction
  await runTest('TEST 8: Automatic redaction scrubs passwords, tokens, cookies, secrets', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'redaction_test_clone';

    // Simulate accidentally passing sensitive fields
    observer.recordRequestStarted(cloneId, {
      method: 'POST',
      url: 'https://auth.example.com/login?token=super_secret_token_123&code=secret_code',
      headers: {
        'authorization': 'Bearer secret_access_token_xyz',
        'cookie': 'session_id=ultra_secret_cookie; secret=true',
        'content-type': 'application/json'
      },
      password: 'MyRealPassword123!',
      secretKey: 'sk_live_123456789'
    });

    const events = observer.getEvents(cloneId);
    const serialized = JSON.stringify(events);

    assert(!serialized.includes('super_secret_token_123'), 'Token leaked in URL');
    assert(!serialized.includes('MyRealPassword123!'), 'Password leaked in payload');
    assert(!serialized.includes('secret_access_token_xyz'), 'Bearer token leaked in headers');
    assert(!serialized.includes('ultra_secret_cookie'), 'Session cookie leaked in headers');
    assert(!serialized.includes('sk_live_123456789'), 'Secret key leaked');
  });

  // TEST 9: Diagnostic Panel readout format
  await runTest('TEST 9: Developer Diagnostic Panel formatting (checklist & timeline)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'panel_test_clone';

    observer.recordFormDetected(cloneId, { hasUsername: true, hasPassword: true, hasSubmit: true });
    observer.recordLoginAction(cloneId, { trigger: 'button_click' });
    observer.recordRequestStarted(cloneId, { method: 'POST', url: 'https://api.example.com/login' });
    observer.recordResponse(cloneId, { status: 200, duration: 95 });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    const readout = AuthDiagnosticsEngine.formatPanelReadout(report);

    assert(readout.includes('AUTHENTICATION DIAGNOSTIC PANEL'));
    assert(readout.includes('Form detected              ✓'));
    assert(readout.includes('Login action detected      ✓'));
    assert(readout.includes('Request generated          ✓'));
    assert(readout.includes('Target responded           ✓'));
    assert(readout.includes('HTTP status                200'));
    assert(readout.includes('Session established        ✕'));
    assert(readout.includes('Authenticated UI           ✕'));
    assert(readout.includes('RESULT:                    AUTH_SESSION_NOT_ESTABLISHED'));
    assert(readout.includes('FAILURE LAYER:             SESSION_HANDLING'));
    assert(readout.includes('CHRONOLOGICAL TIMELINE:'));
    assert(readout.includes('LOGIN FORM DETECTED'));
    assert(readout.includes('LOGIN SUBMITTED'));
    assert(readout.includes('AUTH REQUEST STARTED'));
    assert(readout.includes('AUTH RESPONSE RECEIVED'));
  });

  // TEST 10: Disabled login button due to DOM/State desynchronization
  await runTest('TEST 10: Button disabled due to DOM/State desync -> BUTTON_DISABLED_STATE_DESYNC', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'state_desync_clone';

    observer.recordFormInspection(cloneId, {
      inputs: {
        username: {
          tag: 'input',
          type: 'text',
          name: 'username',
          id: 'login-username',
          valuePresent: true,
          valueLength: 9,
          valid: true,
          frameworkState: { detected: true, type: 'react', appValuePresent: true, isSynced: true }
        },
        password: {
          tag: 'input',
          type: 'password',
          name: 'password',
          id: 'login-password',
          valuePresent: true,
          valueLength: 8,
          valid: true,
          frameworkState: { detected: true, type: 'react', appValuePresent: false, appValueLength: 0, isSynced: false }
        }
      },
      button: {
        tag: 'button',
        type: 'submit',
        disabled: true,
        ariaDisabled: false,
        className: 'sqdOP L3NKy y3zKF',
        closestForm: { id: 'loginForm', action: '' },
        hasClickHandler: true,
        reactPropsDisabled: true
      },
      disableReason: 'STATE_SYNCHRONIZATION_FAILURE: DOM has password value but framework/application state is empty'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.BUTTON_DISABLED_STATE_DESYNC);
    assert.strictEqual(report.failureLayer, FAILURE_LAYER.CLONED_FRONTEND);
    assert.strictEqual(report.checklist.button.loginDisabled, true);
    assert.strictEqual(report.checklist.state.domAppStateSynced, false);
    assert(report.summary.includes('STATE SYNCHRONIZATION FAILURE'));

    const readout = AuthDiagnosticsEngine.formatPanelReadout(report);
    assert(readout.includes('DOM ↔ APP STATE         ✕'));
    assert(readout.includes('Login disabled          ✓'));
    assert(readout.includes('Disable reason          STATE_SYNCHRONIZATION_FAILURE'));
  });

  // TEST 11: Disabled login button due to client validation failure (e.g. password too short)
  await runTest('TEST 11: Button disabled due to validation failure -> BUTTON_DISABLED_VALIDATION', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'validation_fail_clone';

    observer.recordFormInspection(cloneId, {
      inputs: {
        username: {
          tag: 'input',
          type: 'text',
          name: 'username',
          id: 'user-input',
          valuePresent: true,
          valueLength: 5,
          valid: true
        },
        password: {
          tag: 'input',
          type: 'password',
          name: 'password',
          id: 'pass-input',
          valuePresent: true,
          valueLength: 4,
          valid: false,
          validationMessage: 'Password must be at least 6 characters'
        }
      },
      button: {
        tag: 'button',
        type: 'submit',
        disabled: true,
        ariaDisabled: false,
        className: 'btn-submit'
      },
      disableReason: 'PASSWORD_TOO_SHORT: Password length (4) < 6'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.BUTTON_DISABLED_VALIDATION);
    assert.strictEqual(report.checklist.form.passwordValid, false);
    assert.strictEqual(report.checklist.form.formValid, false);
    assert(report.summary.includes('FORM VALIDATION FAILED'));

    const readout = AuthDiagnosticsEngine.formatPanelReadout(report);
    assert(readout.includes('Password valid          ✕'));
    assert(readout.includes('Form valid              ✕'));
    assert(readout.includes('PASSWORD_TOO_SHORT'));
  });

  // TEST 12: Disabled login button with unknown condition
  await runTest('TEST 12: Button disabled with unknown condition -> BUTTON_DISABLED_UNKNOWN', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'unknown_condition_clone';

    observer.recordFormInspection(cloneId, {
      inputs: {
        username: {
          tag: 'input',
          type: 'text',
          valuePresent: true,
          valueLength: 8,
          valid: true
        },
        password: {
          tag: 'input',
          type: 'password',
          valuePresent: true,
          valueLength: 12,
          valid: true
        }
      },
      button: {
        tag: 'button',
        type: 'submit',
        disabled: true,
        ariaDisabled: false
      },
      disableReason: 'DISABLE_REASON: UNKNOWN'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.classification, AUTH_CLASSIFICATION.BUTTON_DISABLED_UNKNOWN);
    assert.strictEqual(report.checklist.button.loginDisabled, true);
    assert.strictEqual(report.checklist.button.disableReason, 'DISABLE_REASON: UNKNOWN');
    assert(report.summary.includes('BUTTON DISABLED CONDITION UNKNOWN'));

    const readout = AuthDiagnosticsEngine.formatPanelReadout(report);
    assert(readout.includes('Disable reason          DISABLE_REASON: UNKNOWN'));
  });

  // TEST 13: Manual typing test comparison recording
  await runTest('TEST 13: Manual typing vs Autofill comparison recorded and formatted', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'typing_test_clone';

    observer.recordManualTypingTest(cloneId, {
      manual: { domValue: true, appState: true, formValid: true, buttonEnabled: true },
      autofill: { domValue: true, appState: false, formValid: false, buttonEnabled: false },
      comparisonSummary: 'Manual typing triggers React synthetic events enabling the button, whereas browser autofill populates DOM value without state synchronization.'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert(report.typingTest);
    assert.strictEqual(report.typingTest.manual.buttonEnabled, true);
    assert.strictEqual(report.typingTest.autofill.buttonEnabled, false);

    const readout = AuthDiagnosticsEngine.formatPanelReadout(report);
    assert(readout.includes('MANUAL TYPING VS AUTOFILL TEST COMPARISON'));
    assert(readout.includes('MANUAL:   DOM: ✓ | App: ✓ | Valid: ✓ | Enabled: ✓'));
    assert(readout.includes('AUTOFILL: DOM: ✓ | App: ✕ | Valid: ✕ | Enabled: ✕'));
  });

  // TEST 14: Strict safety - password value is NEVER recorded in inspections or event traces
  await runTest('TEST 14: Safe inspection - password value is NEVER recorded', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'safe_inspection_clone';

    observer.recordInputEvent(cloneId, {
      field: 'password',
      event: 'input',
      valuePresent: true,
      valueLength: 10,
      timestamp: Date.now()
    });

    observer.recordFormInspection(cloneId, {
      inputs: {
        password: {
          tag: 'input',
          type: 'password',
          name: 'password',
          valuePresent: true,
          valueLength: 10
        }
      },
      button: { disabled: true }
    });

    const events = observer.getEvents(cloneId);
    const serialized = JSON.stringify(events);

    assert(serialized.includes('valueLength":10'));
    assert(serialized.includes('valuePresent":true'));
    assert(!serialized.includes('SecretPassword'));
    assert(!serialized.includes('••••••••'));
  });

  // TEST 15: 10-Stage Pipeline: BUTTON_DISABLED_FAILURE (Stops at Stage 4)
  await runTest('TEST 15: Pipeline Stage 4 -> BUTTON_DISABLED_FAILURE (Stops at button state)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'btn_disabled_pipeline_clone';

    observer.recordFormInspection(cloneId, {
      inputs: {
        username: { tag: 'input', type: 'text', name: 'username', valuePresent: true, valueLength: 9, valid: true, frameworkState: { detected: true, type: 'react', appValuePresent: true, isSynced: true } },
        password: { tag: 'input', type: 'password', name: 'password', valuePresent: true, valueLength: 8, valid: true, frameworkState: { detected: true, type: 'react', appValuePresent: true, isSynced: true } }
      },
      button: { tag: 'button', type: 'submit', disabled: true, ariaDisabled: false, hasDisabledAttr: true, hasClickHandler: true, reactPropsDisabled: true },
      disableReason: 'BUTTON_DISABLED_ATTRIBUTE_PRESENT'
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.firstFailure, FIRST_FAILURE.BUTTON_DISABLED_FAILURE);
    assert.strictEqual(report.pipeline.dom.status, '✓');
    assert.strictEqual(report.pipeline.appState.status, '✓');
    assert.strictEqual(report.pipeline.validation.status, '✓');
    assert.strictEqual(report.pipeline.button.status, '✕');
    assert.strictEqual(report.pipeline.click.status, '-');
    assert.strictEqual(report.pipeline.submit.status, '-');
    assert.strictEqual(report.pipeline.network.status, '-');
    assert.strictEqual(report.pipeline.bridge.status, '-');
    assert.strictEqual(report.pipeline.target.status, '-');
    assert.strictEqual(report.pipeline.session.status, '-');

    const readout = AuthDiagnosticsEngine.formatPanelReadout(report);
    assert(readout.includes('[✓] DOM values detected'));
    assert(readout.includes('[✓] Application state detected'));
    assert(readout.includes('[✓] Form validation'));
    assert(readout.includes('[✕] Login button'));
    assert(readout.includes('[ ] Click'));
    assert(readout.includes('[ ] Submit'));
    assert(readout.includes('[ ] Network'));
    assert(readout.includes('FIRST FAILURE:\nBUTTON_DISABLED_FAILURE'));
  });

  // TEST 16: 10-Stage Pipeline: CLICK_HANDLER_FAILURE (Stops at Stage 5)
  await runTest('TEST 16: Pipeline Stage 5 -> CLICK_HANDLER_FAILURE (Click attempted without executing handler)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'click_handler_fail_clone';

    observer.recordFormInspection(cloneId, {
      inputs: {
        username: { tag: 'input', type: 'text', name: 'username', valuePresent: true, valueLength: 9, valid: true },
        password: { tag: 'input', type: 'password', name: 'password', valuePresent: true, valueLength: 8, valid: true }
      },
      button: { tag: 'button', type: 'submit', disabled: false, hasClickHandler: false },
      disableReason: 'BUTTON_NOT_DISABLED'
    });

    observer.recordClickAttempt(cloneId, {
      buttonTag: 'button',
      buttonDisabled: false,
      hasClickHandler: false
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.firstFailure, FIRST_FAILURE.CLICK_HANDLER_FAILURE);
    assert.strictEqual(report.pipeline.button.status, '✓');
    assert.strictEqual(report.pipeline.click.status, '✕');
    assert.strictEqual(report.pipeline.submit.status, '-');
  });

  // TEST 17: 10-Stage Pipeline: FORM_SUBMISSION_FAILURE (Stops at Stage 6)
  await runTest('TEST 17: Pipeline Stage 6 -> FORM_SUBMISSION_FAILURE (Click fired, submit not dispatched)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'form_submission_fail_clone';

    observer.recordFormInspection(cloneId, {
      inputs: {
        username: { tag: 'input', type: 'text', name: 'username', valuePresent: true, valueLength: 9, valid: true },
        password: { tag: 'input', type: 'password', name: 'password', valuePresent: true, valueLength: 8, valid: true }
      },
      button: { tag: 'button', type: 'submit', disabled: false, hasClickHandler: true },
      disableReason: 'BUTTON_NOT_DISABLED'
    });

    observer.recordClickAttempt(cloneId, {
      buttonTag: 'button',
      buttonDisabled: false,
      hasClickHandler: true
    });
    // Click fired handler, but submit didn't fire and no network request was generated

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.firstFailure, FIRST_FAILURE.FORM_SUBMISSION_FAILURE);
    assert.strictEqual(report.pipeline.click.status, '✓');
    assert.strictEqual(report.pipeline.submit.status, '✕');
    assert.strictEqual(report.pipeline.network.status, '-');
  });

  // TEST 18: 10-Stage Pipeline: NETWORK_REQUEST_NOT_CREATED (Stops at Stage 7)
  await runTest('TEST 18: Pipeline Stage 7 -> NETWORK_REQUEST_NOT_CREATED (Submit dispatched without outgoing fetch/xhr)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'net_req_not_created_clone';

    observer.recordFormInspection(cloneId, {
      inputs: {
        username: { tag: 'input', type: 'text', name: 'username', valuePresent: true, valueLength: 9, valid: true },
        password: { tag: 'input', type: 'password', name: 'password', valuePresent: true, valueLength: 8, valid: true }
      },
      button: { tag: 'button', type: 'submit', disabled: false, hasClickHandler: true },
      disableReason: 'BUTTON_NOT_DISABLED'
    });

    observer.recordClickAttempt(cloneId, { buttonTag: 'button', buttonDisabled: false, hasClickHandler: true });
    observer.recordSubmitAttempt(cloneId, { formId: 'loginForm', submitFired: true });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.firstFailure, FIRST_FAILURE.NETWORK_REQUEST_NOT_CREATED);
    assert.strictEqual(report.pipeline.submit.status, '✓');
    assert.strictEqual(report.pipeline.network.status, '✕');
    assert.strictEqual(report.pipeline.bridge.status, '-');
  });

  // TEST 19: 10-Stage Pipeline: BRIDGE_NOT_REACHED & BRIDGE_ROUTING_FAILURE (Stage 8)
  await runTest('TEST 19: Pipeline Stage 8 -> BRIDGE_NOT_REACHED and BRIDGE_ROUTING_FAILURE', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'bridge_fail_clone';

    observer.recordFormInspection(cloneId, {
      inputs: { username: { valuePresent: true, valid: true }, password: { valuePresent: true, valid: true } },
      button: { disabled: false }
    });
    observer.recordClickAttempt(cloneId, {});
    observer.recordSubmitAttempt(cloneId, { submitFired: true });
    observer.recordRequestStarted(cloneId, { method: 'POST', url: 'https://example.com/api/login' });
    observer.recordNetworkError(cloneId, { errorType: 'CORS_FAILURE', message: 'Blocked by CORS before bridge' });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.firstFailure, FIRST_FAILURE.BRIDGE_NOT_REACHED);
    assert.strictEqual(report.pipeline.network.status, '✓');
    assert.strictEqual(report.pipeline.bridge.status, '✕');
    assert.strictEqual(report.pipeline.target.status, '-');
  });

  // TEST 20: 10-Stage Pipeline: TARGET_AUTH_REJECTED (Stage 9)
  await runTest('TEST 20: Pipeline Stage 9 -> TARGET_AUTH_REJECTED (Target rejects credentials with 401)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'target_reject_clone';

    observer.recordFormInspection(cloneId, {
      inputs: { username: { valuePresent: true, valid: true }, password: { valuePresent: true, valid: true } },
      button: { disabled: false }
    });
    observer.recordClickAttempt(cloneId, {});
    observer.recordSubmitAttempt(cloneId, { submitFired: true });
    observer.recordRequestStarted(cloneId, { method: 'POST', url: '/bridge/clone/test/api/login', resourceType: 'bridge' });
    observer.recordResponse(cloneId, { status: 401, errorSnippet: 'Invalid credentials' });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.firstFailure, FIRST_FAILURE.TARGET_AUTH_REJECTED);
    assert.strictEqual(report.pipeline.bridge.status, '✓');
    assert.strictEqual(report.pipeline.target.status, '✕');
    assert.strictEqual(report.pipeline.session.status, '-');
  });

  // TEST 21: 10-Stage Pipeline: AUTH_SESSION_NOT_ESTABLISHED (Stage 10)
  await runTest('TEST 21: Pipeline Stage 10 -> AUTH_SESSION_NOT_ESTABLISHED (200 OK without local session)', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'session_missing_clone';

    observer.recordFormInspection(cloneId, {
      inputs: { username: { valuePresent: true, valid: true }, password: { valuePresent: true, valid: true } },
      button: { disabled: false }
    });
    observer.recordClickAttempt(cloneId, {});
    observer.recordSubmitAttempt(cloneId, { submitFired: true });
    observer.recordRequestStarted(cloneId, { method: 'POST', url: '/bridge/clone/test/api/login', resourceType: 'bridge' });
    observer.recordResponse(cloneId, { status: 200 });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    assert.strictEqual(report.firstFailure, FIRST_FAILURE.AUTH_SESSION_NOT_ESTABLISHED);
    assert.strictEqual(report.pipeline.target.status, '✓');
    assert.strictEqual(report.pipeline.session.status, '✕');
  });

  // TEST 22: Safe DOM attributes check - password value NEVER leaked in step 1 DOM inspection
  await runTest('TEST 22: Safe DOM inspection only reports metadata and never password', () => {
    const observer = new AuthenticationFlowObserver();
    const cloneId = 'safe_dom_clone';

    observer.recordFormInspection(cloneId, {
      inputs: {
        username: { tag: 'input', type: 'text', name: 'username', id: 'u1', autocomplete: 'username', required: true, disabled: false, valuePresent: true, valueLength: 8 },
        password: { tag: 'input', type: 'password', name: 'password', id: 'p1', autocomplete: 'current-password', required: true, disabled: false, valuePresent: true, valueLength: 12 }
      },
      button: { disabled: true }
    });

    const report = AuthDiagnosticsEngine.diagnose({
      events: observer.getEvents(cloneId),
      state: observer.getState(cloneId)
    });

    const dom = report.domInspection;
    assert.strictEqual(dom.usernamePresent, true);
    assert.strictEqual(dom.passwordPresent, true);
    assert.strictEqual(dom.usernameLength, 8);
    assert.strictEqual(dom.passwordLength, 12);
    assert.strictEqual(dom.inputType, 'password');
    assert.strictEqual(dom.name, 'password');
    assert.strictEqual(dom.id, 'p1');
    assert.strictEqual(dom.autocomplete, 'current-password');
    assert.strictEqual(dom.required, true);
    assert.strictEqual(dom.disabled, false);
    assert.strictEqual(typeof dom.password, 'undefined');
    assert.strictEqual(typeof dom.value, 'undefined');
  });

  // Print results
  console.log('\n======================================================');
  console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('======================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
