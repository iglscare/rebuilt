/**
 * REBUILT — Phase: Find The Real Login Blocker
 * 
 * 10-Stage Authentication Execution Pipeline & First-Failure Diagnostic Engine:
 * 
 * USER INPUT -> DOM VALUE -> APPLICATION STATE -> FORM VALIDATION -> BUTTON STATE ->
 * CLICK EVENT -> FORM SUBMIT -> NETWORK REQUEST -> LOCAL BRIDGE -> TARGET SERVER -> AUTH STATE
 * 
 * Stops at the FIRST stage that fails and assigns exactly ONE classification:
 * - FORM_STATE_FAILURE
 * - FORM_VALIDATION_FAILURE
 * - BUTTON_DISABLED_FAILURE
 * - CLICK_HANDLER_FAILURE
 * - FORM_SUBMISSION_FAILURE
 * - NETWORK_REQUEST_NOT_CREATED
 * - BRIDGE_NOT_REACHED
 * - BRIDGE_ROUTING_FAILURE
 * - TARGET_REQUEST_FAILURE
 * - TARGET_AUTH_REJECTED
 * - AUTH_CHALLENGE_REQUIRED
 * - AUTH_SESSION_NOT_ESTABLISHED
 * - UNKNOWN
 */

const { EVENT_TYPES } = require('./auth-flow-observer');

const FIRST_FAILURE = {
  FORM_STATE_FAILURE: 'FORM_STATE_FAILURE',
  FORM_VALIDATION_FAILURE: 'FORM_VALIDATION_FAILURE',
  BUTTON_DISABLED_FAILURE: 'BUTTON_DISABLED_FAILURE',
  CLICK_HANDLER_FAILURE: 'CLICK_HANDLER_FAILURE',
  FORM_SUBMISSION_FAILURE: 'FORM_SUBMISSION_FAILURE',
  NETWORK_REQUEST_NOT_CREATED: 'NETWORK_REQUEST_NOT_CREATED',
  BRIDGE_NOT_REACHED: 'BRIDGE_NOT_REACHED',
  BRIDGE_ROUTING_FAILURE: 'BRIDGE_ROUTING_FAILURE',
  TARGET_REQUEST_FAILURE: 'TARGET_REQUEST_FAILURE',
  TARGET_AUTH_REJECTED: 'TARGET_AUTH_REJECTED',
  AUTH_CHALLENGE_REQUIRED: 'AUTH_CHALLENGE_REQUIRED',
  AUTH_SESSION_NOT_ESTABLISHED: 'AUTH_SESSION_NOT_ESTABLISHED',
  UNKNOWN: 'UNKNOWN'
};

const AUTH_CLASSIFICATION = {
  ...FIRST_FAILURE,
  AUTH_SUCCESS: 'AUTH_SUCCESS',
  AUTH_REJECTED: 'AUTH_REJECTED',
  AUTH_REDIRECT: 'AUTH_REDIRECT',
  AUTH_CHALLENGE: 'AUTH_CHALLENGE',
  AUTH_MFA_REQUIRED: 'AUTH_MFA_REQUIRED',
  AUTH_CAPTCHA_REQUIRED: 'AUTH_CAPTCHA_REQUIRED',
  AUTH_SESSION_NOT_ESTABLISHED: 'AUTH_SESSION_NOT_ESTABLISHED',
  AUTH_REQUEST_FAILED: 'AUTH_REQUEST_FAILED',
  AUTH_NETWORK_FAILED: 'AUTH_NETWORK_FAILED',
  AUTH_CORS_FAILED: 'AUTH_CORS_FAILED',
  AUTH_REDIRECT_FAILED: 'AUTH_REDIRECT_FAILED',
  AUTH_UNSUPPORTED: 'AUTH_UNSUPPORTED',
  AUTH_UNKNOWN: 'AUTH_UNKNOWN',
  // Specific Button Disabled & State Diagnostics aliases:
  BUTTON_DISABLED_STATE_DESYNC: 'BUTTON_DISABLED_STATE_DESYNC',
  BUTTON_DISABLED_VALIDATION: 'BUTTON_DISABLED_VALIDATION',
  BUTTON_DISABLED_EMPTY_FIELDS: 'BUTTON_DISABLED_EMPTY_FIELDS',
  BUTTON_DISABLED_UNKNOWN: 'BUTTON_DISABLED_UNKNOWN'
};

const FAILURE_LAYER = {
  CLONED_FRONTEND: 'CLONED_FRONTEND',
  COMMUNICATION_LAYER: 'COMMUNICATION_LAYER',
  TARGET_AUTHENTICATION: 'TARGET_AUTHENTICATION',
  SESSION_HANDLING: 'SESSION_HANDLING',
  UNKNOWN: 'UNKNOWN'
};

class AuthDiagnosticsEngine {
  /**
   * Diagnoses an authentication flow given its recorded events and observed state.
   *
   * @param {object} params
   * @param {Array<object>} params.events - Chronological list of events from observer
   * @param {object} params.state - Aggregated state from observer
   * @param {object} [params.context] - Additional metadata (e.g. targetOrigin, cloneId)
   * @returns {object} Full diagnostic report
   */
  static diagnose({ events = [], state = {}, context = {} }) {
    const inspection = state.inspection || (function() {
      const inspectEvt = [...events].reverse().find(e => e.type === EVENT_TYPES.FORM_INSPECTION);
      return inspectEvt ? inspectEvt.payload : null;
    })();

    const usernameInput = inspection && inspection.inputs ? inspection.inputs.username : null;
    const passwordInput = inspection && inspection.inputs ? inspection.inputs.password : null;
    const buttonData = inspection ? inspection.button : null;

    // STEP 1 — DOM INPUTS
    const hasExplicitInspection = Boolean(inspection && inspection.inputs);
    let usernamePresent = false;
    let passwordPresent = false;
    let usernameLength = 0;
    let passwordLength = 0;

    if (hasExplicitInspection) {
      usernameLength = usernameInput && typeof usernameInput.valueLength === 'number'
        ? usernameInput.valueLength
        : (usernameInput && usernameInput.valuePresent ? 1 : 0);
      passwordLength = passwordInput && typeof passwordInput.valueLength === 'number'
        ? passwordInput.valueLength
        : (passwordInput && passwordInput.valuePresent ? 1 : 0);
      usernamePresent = Boolean(usernameInput && (usernameInput.valuePresent || usernameLength > 0));
      passwordPresent = Boolean(passwordInput && (passwordInput.valuePresent || passwordLength > 0));
    } else if (state.requestGenerated || state.loginActionDetected || (state.formDetected && (state.formDetected.hasUsername || state.formDetected.usernameField || state.formDetected.hasPassword || state.formDetected.passwordField))) {
      // High-level observation or test simulation without explicit DOM inspection
      usernamePresent = true;
      passwordPresent = true;
      usernameLength = 8;
      passwordLength = 8;
    }

    const domInspection = {
      usernamePresent,
      passwordPresent,
      usernameLength,
      passwordLength,
      inputType: passwordInput ? passwordInput.type : (usernameInput ? usernameInput.type : 'text'),
      name: passwordInput ? passwordInput.name : (usernameInput ? usernameInput.name : ''),
      id: passwordInput ? passwordInput.id : (usernameInput ? usernameInput.id : ''),
      autocomplete: passwordInput ? passwordInput.autocomplete : (usernameInput ? usernameInput.autocomplete : ''),
      required: Boolean((passwordInput && passwordInput.required) || (usernameInput && usernameInput.required)),
      disabled: Boolean((passwordInput && passwordInput.disabled) || (usernameInput && usernameInput.disabled))
    };

    // STEP 2 — APPLICATION STATE
    let usernameAppState = 'UNKNOWN';
    let passwordAppState = 'UNKNOWN';
    let domAppStateSynced = true;

    if (usernameInput && usernameInput.frameworkState && usernameInput.frameworkState.detected) {
      usernameAppState = usernameInput.frameworkState.appValuePresent ? 'PRESENT' : 'EMPTY';
      if (usernameInput.frameworkState.isSynced === false) domAppStateSynced = false;
    } else if (usernameInput) {
      usernameAppState = usernamePresent ? 'PRESENT' : 'EMPTY';
    } else if (!hasExplicitInspection && (state.requestGenerated || state.loginActionDetected)) {
      usernameAppState = 'PRESENT';
    }

    if (passwordInput && passwordInput.frameworkState && passwordInput.frameworkState.detected) {
      passwordAppState = passwordInput.frameworkState.appValuePresent ? 'PRESENT' : 'EMPTY';
      if (passwordInput.frameworkState.isSynced === false) domAppStateSynced = false;
    } else if (passwordInput) {
      passwordAppState = passwordPresent ? 'PRESENT' : 'EMPTY';
    } else if (!hasExplicitInspection && (state.requestGenerated || state.loginActionDetected)) {
      passwordAppState = 'PRESENT';
    }

    if (inspection && inspection.stateSync && typeof inspection.stateSync.overallSynced === 'boolean') {
      domAppStateSynced = inspection.stateSync.overallSynced;
      if (!domAppStateSynced && passwordAppState !== 'UNKNOWN') passwordAppState = 'EMPTY';
    } else if (inspection && inspection.disableReason && inspection.disableReason.includes('STATE_SYNCHRONIZATION_FAILURE')) {
      domAppStateSynced = false;
      passwordAppState = 'EMPTY';
    }

    const appStateComparison = {
      username: {
        dom: usernamePresent ? 'PRESENT' : 'EMPTY',
        appState: usernameAppState
      },
      password: {
        dom: passwordPresent ? 'PRESENT' : 'EMPTY',
        appState: passwordAppState
      },
      synced: domAppStateSynced
    };

    // STEP 3 — FORM VALIDATION
    const uValid = usernameInput ? Boolean(usernameInput.valid !== false) : true;
    const pValid = passwordInput ? Boolean(passwordInput.valid !== false) : true;
    let formValidBool = uValid && pValid;
    if (inspection && inspection.validation && typeof inspection.validation.formValid === 'boolean') {
      formValidBool = inspection.validation.formValid;
    }
    if (inspection && inspection.disableReason && (inspection.disableReason.includes('PASSWORD_TOO_SHORT') || inspection.disableReason.includes('VALIDATION_FAILED'))) {
      formValidBool = false;
    }

    const isButtonDisabled = buttonData
      ? Boolean(buttonData.disabled || buttonData.isAriaDisabled || buttonData.reactPropsDisabled || inspection.buttonDisabled)
      : false;

    const disableReason = inspection
      ? (inspection.disableReason || (isButtonDisabled ? 'BUTTON_DISABLED_ATTRIBUTE_PRESENT' : 'BUTTON_NOT_DISABLED'))
      : (isButtonDisabled ? 'BUTTON_DISABLED_ATTRIBUTE_PRESENT' : 'BUTTON_NOT_DISABLED');

    const validationInspection = {
      formValid: formValidBool ? 'YES' : 'NO',
      buttonDisabled: isButtonDisabled ? 'YES' : 'NO',
      disableReason
    };

    // STEP 4 — CLICK EVENT
    const clickAttemptEvent = events.find(e => e.type === EVENT_TYPES.BUTTON_CLICK_ATTEMPT || e.type === EVENT_TYPES.LOGIN_ACTION);
    const clickBlockedEvent = events.find(e => e.type === EVENT_TYPES.CLICK_BLOCKED_BY_DISABLED_STATE);
    const isClickBlocked = Boolean(clickBlockedEvent || (clickAttemptEvent && clickAttemptEvent.payload && clickAttemptEvent.payload.blockedByDisabledState) || (state.clickAttemptDetected && isButtonDisabled));

    const clickInspection = {
      buttonClickAttempt: Boolean(clickAttemptEvent || state.clickAttemptDetected),
      buttonClickHandler: buttonData ? (buttonData.hasClickHandler ? 'ATTACHED' : 'NOT_FOUND') : 'UNKNOWN',
      formSubmitAttempt: Boolean(state.submitAttemptDetected),
      clickBlockedByDisabledState: isClickBlocked
    };

    // STEP 5 — FORM SUBMISSION
    const submitEvent = events.find(e => e.type === EVENT_TYPES.FORM_SUBMIT_ATTEMPT || (e.type === EVENT_TYPES.LOGIN_ACTION && e.payload.trigger === 'form_submit'));
    const formSubmitFired = Boolean(submitEvent || state.submitFired);

    const formSubmission = {
      formSubmit: formSubmitFired ? 'YES' : 'NO',
      reason: formSubmitFired ? 'Submit event fired' : (isButtonDisabled ? 'CLICK_BLOCKED_BY_DISABLED_STATE' : 'NO_SUBMIT_EVENT_DISPATCHED')
    };

    // STEP 6 — NETWORK
    const reqStartedEvent = events.find(e => e.type === EVENT_TYPES.REQUEST_STARTED);
    const networkInspection = {
      networkRequest: (reqStartedEvent || state.requestGenerated) ? 'STARTED' : 'NOT_STARTED',
      requestUrl: reqStartedEvent ? (reqStartedEvent.payload.url || reqStartedEvent.payload.path) : (state.lastRequest ? state.lastRequest.path : null),
      requestMethod: reqStartedEvent ? reqStartedEvent.payload.method : (state.lastRequest ? state.lastRequest.method : null),
      requestStatus: typeof state.lastHttpStatus === 'number' ? state.lastHttpStatus : null,
      requestDuration: state.lastResponse ? state.lastResponse.duration : null
    };

    // STEP 7 — BRIDGE
    const bridgeReached = Boolean(reqStartedEvent && ((reqStartedEvent.payload.url && reqStartedEvent.payload.url.includes('/bridge/')) || reqStartedEvent.payload.resourceType === 'bridge' || state.targetResponded));
    const bridgeInspection = {
      bridgeStatus: bridgeReached ? 'BRIDGE_REACHED' : ((reqStartedEvent || state.requestGenerated) ? 'BRIDGE_NOT_REACHED' : 'NOT_STARTED'),
      bridgeRequestReceived: bridgeReached,
      bridgeTargetResolved: Boolean(context.targetOrigin || (reqStartedEvent && reqStartedEvent.payload.origin)),
      bridgeUpstreamRequestStarted: Boolean(state.requestGenerated && bridgeReached),
      bridgeUpstreamResponse: Boolean(state.targetResponded)
    };

    // STEP 8 — TARGET
    const targetInspection = {
      targetRequestStarted: Boolean(state.requestGenerated && bridgeReached),
      targetStatus: typeof state.lastHttpStatus === 'number' ? state.lastHttpStatus : null,
      targetResponse: Boolean(state.targetResponded)
    };

    // ========================================================
    // 10-STAGE PIPELINE EVALUATION (STOPS AT FIRST FAILURE)
    // ========================================================
    const pipeline = {
      dom:        { status: '-', label: 'DOM values detected', details: '' },
      appState:   { status: '-', label: 'Application state detected', details: '' },
      validation: { status: '-', label: 'Form validation', details: '' },
      button:     { status: '-', label: 'Login button', details: '' },
      click:      { status: '-', label: 'Click', details: '' },
      submit:     { status: '-', label: 'Submit', details: '' },
      network:    { status: '-', label: 'Network', details: '' },
      bridge:     { status: '-', label: 'Bridge', details: '' },
      target:     { status: '-', label: 'Target', details: '' },
      session:    { status: '-', label: 'Session', details: '' }
    };

    let firstFailure = null;
    let firstFailureReason = '';
    let failureLayer = FAILURE_LAYER.UNKNOWN;
    let legacyClassification = null;

    // Find key response/challenge/error events
    const networkErrorEvent = events.find(e => e.type === EVENT_TYPES.NETWORK_ERROR);
    const challengeEvent = events.find(e => e.type === EVENT_TYPES.CHALLENGE_DETECTED);
    const redirectEvents = events.filter(e => e.type === EVENT_TYPES.REDIRECT);
    const responseEvent = [...events].reverse().find(e => e.type === EVENT_TYPES.RESPONSE);
    const authStateEvent = [...events].reverse().find(e => e.type === EVENT_TYPES.AUTHENTICATED_STATE);
    const httpStatus = typeof state.lastHttpStatus === 'number' ? state.lastHttpStatus : null;

    // Stage 1: DOM
    if (!usernameInput && !passwordInput && !inspection && !state.formDetected) {
      pipeline.dom.status = '✕';
      pipeline.dom.details = 'No input elements detected';
      firstFailure = FIRST_FAILURE.FORM_STATE_FAILURE;
      firstFailureReason = 'No username or password input fields detected in DOM.';
      failureLayer = FAILURE_LAYER.CLONED_FRONTEND;
    } else if (!usernamePresent || !passwordPresent) {
      pipeline.dom.status = '✕';
      pipeline.dom.details = `usernameLen=${usernameLength}, passwordLen=${passwordLength}`;
      firstFailure = FIRST_FAILURE.FORM_STATE_FAILURE;
      firstFailureReason = `Form inputs in DOM are empty (usernameLength: ${usernameLength}, passwordLength: ${passwordLength}).`;
      failureLayer = FAILURE_LAYER.CLONED_FRONTEND;
      legacyClassification = AUTH_CLASSIFICATION.BUTTON_DISABLED_EMPTY_FIELDS;
    } else {
      pipeline.dom.status = '✓';
      pipeline.dom.details = `usernameLen=${usernameLength}, passwordLen=${passwordLength}`;

      // Stage 2: APPLICATION STATE
      if (!domAppStateSynced || passwordAppState === 'EMPTY') {
        pipeline.appState.status = '✕';
        pipeline.appState.details = 'DOM: PRESENT vs APP: EMPTY';
        firstFailure = FIRST_FAILURE.FORM_STATE_FAILURE;
        firstFailureReason = disableReason.includes('STATE_SYNCHRONIZATION_FAILURE')
          ? `STATE SYNCHRONIZATION FAILURE: ${disableReason}`
          : 'STATE SYNCHRONIZATION FAILURE: Form inputs are visually populated in the DOM, but application internal state is empty.';
        failureLayer = FAILURE_LAYER.CLONED_FRONTEND;
        legacyClassification = AUTH_CLASSIFICATION.BUTTON_DISABLED_STATE_DESYNC;
      } else {
        pipeline.appState.status = '✓';
        pipeline.appState.details = 'DOM ↔ APP state synchronized';

        // Stage 3: FORM VALIDATION
        if (!formValidBool || disableReason.includes('PASSWORD_TOO_SHORT') || disableReason.includes('VALIDATION_FAILED')) {
          pipeline.validation.status = '✕';
          pipeline.validation.details = disableReason;
          firstFailure = FIRST_FAILURE.FORM_VALIDATION_FAILURE;
          firstFailureReason = `FORM VALIDATION FAILED: ${disableReason}`;
          failureLayer = FAILURE_LAYER.CLONED_FRONTEND;
          legacyClassification = AUTH_CLASSIFICATION.BUTTON_DISABLED_VALIDATION;
        } else {
          pipeline.validation.status = '✓';
          pipeline.validation.details = 'Form constraints valid';

          // Stage 4: BUTTON STATE
          if (isButtonDisabled) {
            pipeline.button.status = '✕';
            pipeline.button.details = disableReason;
            firstFailure = FIRST_FAILURE.BUTTON_DISABLED_FAILURE;
            firstFailureReason = disableReason === 'DISABLE_REASON: UNKNOWN'
              ? 'BUTTON DISABLED CONDITION UNKNOWN: The cloned frontend button is disabled, but the application condition could not be inferred from DOM attributes or state.'
              : disableReason;
            failureLayer = FAILURE_LAYER.CLONED_FRONTEND;
            legacyClassification = disableReason === 'DISABLE_REASON: UNKNOWN'
              ? AUTH_CLASSIFICATION.BUTTON_DISABLED_UNKNOWN
              : AUTH_CLASSIFICATION.BUTTON_DISABLED_FAILURE;
          } else {
            pipeline.button.status = '✓';
            pipeline.button.details = 'Button enabled';

            // Stage 5: CLICK EVENT
            if (clickInspection.buttonClickAttempt || state.loginActionDetected) {
              if (buttonData && !buttonData.hasClickHandler && !submitEvent && !state.requestGenerated) {
                pipeline.click.status = '✕';
                pipeline.click.details = 'No click handler attached';
                firstFailure = FIRST_FAILURE.CLICK_HANDLER_FAILURE;
                firstFailureReason = 'Login button was clicked, but no click handler executed.';
                failureLayer = FAILURE_LAYER.CLONED_FRONTEND;
                legacyClassification = AUTH_CLASSIFICATION.AUTH_REQUEST_FAILED;
              } else {
                pipeline.click.status = '✓';
                pipeline.click.details = 'Click received';

                // Stage 6: FORM SUBMIT
                if (!formSubmitFired && !state.requestGenerated && !reqStartedEvent) {
                  pipeline.submit.status = '✕';
                  pipeline.submit.details = 'Submit event not fired';
                  firstFailure = FIRST_FAILURE.FORM_SUBMISSION_FAILURE;
                  firstFailureReason = 'Button click did not trigger form submission event.';
                  failureLayer = FAILURE_LAYER.CLONED_FRONTEND;
                  legacyClassification = AUTH_CLASSIFICATION.AUTH_REQUEST_FAILED;
                } else {
                  pipeline.submit.status = '✓';
                  pipeline.submit.details = 'Submit triggered';

                  // Stage 7: NETWORK
                  if (!state.requestGenerated && !reqStartedEvent) {
                    pipeline.network.status = '✕';
                    pipeline.network.details = 'No request dispatched';
                    firstFailure = FIRST_FAILURE.NETWORK_REQUEST_NOT_CREATED;
                    firstFailureReason = 'Login submission was triggered on the cloned frontend, but no outgoing network request was dispatched.';
                    failureLayer = FAILURE_LAYER.CLONED_FRONTEND;
                    legacyClassification = AUTH_CLASSIFICATION.AUTH_REQUEST_FAILED;
                  } else {
                    pipeline.network.status = '✓';
                    pipeline.network.details = `${networkInspection.requestMethod || 'POST'} ${networkInspection.requestUrl || ''}`;

                    // Stage 8: BRIDGE
                    if (networkErrorEvent && networkErrorEvent.payload.errorType === 'CORS_FAILURE') {
                      pipeline.bridge.status = '✕';
                      pipeline.bridge.details = 'CORS blocked before bridge';
                      firstFailure = FIRST_FAILURE.BRIDGE_NOT_REACHED;
                      firstFailureReason = 'The login request was blocked by browser Cross-Origin Resource Sharing (CORS) policy before reaching the local bridge.';
                      failureLayer = FAILURE_LAYER.COMMUNICATION_LAYER;
                      legacyClassification = AUTH_CLASSIFICATION.AUTH_CORS_FAILED;
                    } else if (state.networkError && (state.networkError.code === 'BRIDGE_ROUTE_NOT_FOUND' || state.networkError.code === 'BRIDGE_TARGET_NOT_ALLOWED')) {
                      pipeline.bridge.status = '✕';
                      pipeline.bridge.details = state.networkError.code;
                      firstFailure = FIRST_FAILURE.BRIDGE_ROUTING_FAILURE;
                      firstFailureReason = state.networkError.message;
                      failureLayer = FAILURE_LAYER.COMMUNICATION_LAYER;
                      legacyClassification = AUTH_CLASSIFICATION.AUTH_NETWORK_FAILED;
                    } else {
                      pipeline.bridge.status = '✓';
                      pipeline.bridge.details = 'Bridge active';

                      // Stage 9: TARGET
                      if (networkErrorEvent || (state.networkError && state.networkError.errorType !== 'CORS_FAILURE')) {
                        pipeline.target.status = '✕';
                        pipeline.target.details = 'Network transport error';
                        firstFailure = FIRST_FAILURE.TARGET_REQUEST_FAILURE;
                        firstFailureReason = (networkErrorEvent ? networkErrorEvent.payload.message : state.networkError.message) || 'Network transport failure reaching target server';
                        failureLayer = FAILURE_LAYER.COMMUNICATION_LAYER;
                        legacyClassification = AUTH_CLASSIFICATION.AUTH_NETWORK_FAILED;
                      } else if (redirectEvents.length > 0 && redirectEvents.some(r => r.payload.completed === false || (r.payload.status && r.payload.status >= 400))) {
                        pipeline.target.status = '✕';
                        pipeline.target.details = 'Redirect chain failed';
                        firstFailure = FIRST_FAILURE.TARGET_REQUEST_FAILURE;
                        firstFailureReason = 'An authentication redirect occurred, but the target callback or redirection failed.';
                        failureLayer = FAILURE_LAYER.COMMUNICATION_LAYER;
                        legacyClassification = AUTH_CLASSIFICATION.AUTH_REDIRECT_FAILED;
                      } else if (challengeEvent || state.challengeDetected) {
                        pipeline.target.status = '✕';
                        pipeline.target.details = 'Security challenge';
                        const cType = challengeEvent ? challengeEvent.payload.challengeType : 'SECURITY_CHALLENGE';
                        firstFailure = FIRST_FAILURE.AUTH_CHALLENGE_REQUIRED;
                        firstFailureReason = `Target required authentication challenge: ${cType}`;
                        failureLayer = FAILURE_LAYER.TARGET_AUTHENTICATION;
                        if (cType === 'MFA' || cType === '2FA' || cType === 'OTP') {
                          legacyClassification = AUTH_CLASSIFICATION.AUTH_MFA_REQUIRED;
                        } else if (cType === 'CAPTCHA') {
                          legacyClassification = AUTH_CLASSIFICATION.AUTH_CAPTCHA_REQUIRED;
                        } else if (cType === 'INSTAGRAM_CHECKPOINT' || cType === 'UNSUPPORTED_DEVICE_TELEMETRY') {
                          legacyClassification = AUTH_CLASSIFICATION.AUTH_UNSUPPORTED;
                          firstFailureReason = 'The target uses proprietary client device fingerprinting or anti-abuse checkpointing that cannot run outside the official client.';
                        } else {
                          legacyClassification = AUTH_CLASSIFICATION.AUTH_CHALLENGE;
                        }
                      } else if (httpStatus === 401 || httpStatus === 403 || (httpStatus === 400 && responseEvent && /invalid|bad.*credentials|incorrect|denied/i.test(responseEvent.payload.errorSnippet || ''))) {
                        pipeline.target.status = '✕';
                        pipeline.target.details = `HTTP ${httpStatus} Rejected`;
                        firstFailure = FIRST_FAILURE.TARGET_AUTH_REJECTED;
                        firstFailureReason = 'The target authentication service rejected the submitted credentials.';
                        failureLayer = FAILURE_LAYER.TARGET_AUTHENTICATION;
                        legacyClassification = AUTH_CLASSIFICATION.AUTH_REJECTED;
                      } else if (httpStatus && httpStatus >= 400) {
                        pipeline.target.status = '✕';
                        pipeline.target.details = `HTTP ${httpStatus} Error`;
                        firstFailure = FIRST_FAILURE.TARGET_REQUEST_FAILURE;
                        firstFailureReason = `The target authentication endpoint returned an HTTP ${httpStatus} error.`;
                        failureLayer = FAILURE_LAYER.TARGET_AUTHENTICATION;
                        legacyClassification = AUTH_CLASSIFICATION.AUTH_REQUEST_FAILED;
                      } else if (state.targetResponded && (httpStatus === 200 || httpStatus === 204 || (httpStatus >= 300 && httpStatus < 400)) && (!state.sessionEstablished && !state.authenticatedUi)) {
                        pipeline.target.status = '✓';
                        pipeline.session.status = '✕';
                        pipeline.session.details = 'HTTP 200 without local session';
                        firstFailure = FIRST_FAILURE.AUTH_SESSION_NOT_ESTABLISHED;
                        firstFailureReason = 'The cloned frontend completed the login request, but the resulting authenticated state was not established locally.';
                        failureLayer = FAILURE_LAYER.SESSION_HANDLING;
                        legacyClassification = AUTH_CLASSIFICATION.AUTH_SESSION_NOT_ESTABLISHED;
                      } else if (state.sessionEstablished || state.authenticatedUi || (authStateEvent && authStateEvent.payload.established)) {
                        pipeline.target.status = '✓';
                        pipeline.session.status = '✓';
                        pipeline.session.details = 'Session established';
                        firstFailure = null;
                        firstFailureReason = 'Authentication completed successfully. Authenticated state confirmed.';
                        failureLayer = FAILURE_LAYER.UNKNOWN;
                        legacyClassification = AUTH_CLASSIFICATION.AUTH_SUCCESS;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    if (!firstFailure && !state.sessionEstablished && !state.authenticatedUi) {
      firstFailure = FIRST_FAILURE.UNKNOWN;
      firstFailureReason = 'Authentication flow state is inconclusive from available observations.';
      failureLayer = FAILURE_LAYER.UNKNOWN;
      legacyClassification = AUTH_CLASSIFICATION.AUTH_UNKNOWN;
    }

    // Classification mapping for caller compatibility
    const classification = legacyClassification || firstFailure;

    // Build timeline
    const timeline = AuthDiagnosticsEngine.formatTimeline(events, classification);

    const legacyChecklist = {
      formDetected: Boolean(state.formDetected || inspection),
      loginActionDetected: Boolean(state.loginActionDetected || clickInspection.buttonClickAttempt),
      requestGenerated: Boolean(state.requestGenerated),
      targetResponded: Boolean(state.targetResponded),
      httpStatus: state.lastHttpStatus !== null && state.lastHttpStatus !== undefined ? state.lastHttpStatus : 'N/A',
      redirectDetected: Boolean(state.redirectDetected),
      sessionEstablished: Boolean(state.sessionEstablished),
      authenticatedUi: Boolean(state.authenticatedUi)
    };

    const checklist = {
      form: {
        usernameDetected: usernamePresent,
        passwordDetected: passwordPresent,
        usernameValid: uValid,
        passwordValid: pValid,
        formValid: formValidBool
      },
      button: {
        loginDisabled: isButtonDisabled,
        disableReason
      },
      state: {
        domAppStateSynced
      },
      network: {
        requestStarted: Boolean(state.requestGenerated)
      },
      auth: {
        status: state.sessionEstablished ? 'Established' : (state.targetResponded ? 'Target responded' : (state.requestGenerated ? 'In progress' : 'Not started'))
      },
      ...legacyChecklist
    };

    return {
      firstFailure,
      firstFailureReason,
      reason: firstFailureReason,
      classification,
      failureLayer,
      pipeline,
      summary: firstFailureReason,
      domInspection,
      appStateComparison,
      validationInspection,
      clickInspection,
      formSubmission,
      networkInspection,
      bridgeInspection,
      targetInspection,
      checklist,
      inspection,
      inputEvents: state.inputEvents || [],
      typingTest: state.typingTest || null,
      lastHttpStatus: legacyChecklist.httpStatus,
      timeline,
      timestamp: Date.now()
    };
  }

  /**
   * Formats events into a clean chronological text timeline.
   */
  static formatTimeline(events = [], finalClassification = '') {
    return events.map(e => {
      const date = new Date(e.timestamp);
      const timeStr = date.toTimeString().split(' ')[0];

      let label = e.type;
      let description = '';

      switch (e.type) {
        case EVENT_TYPES.FORM_DETECTED:
          label = 'LOGIN FORM DETECTED';
          description = `Inputs: [username: ${e.payload.usernameField ? 'yes' : 'no'}, password: ${e.payload.passwordField ? 'yes' : 'no'}]`;
          break;
        case EVENT_TYPES.FORM_INSPECTION:
          label = 'FORM & BUTTON INSPECTED';
          description = `Button disabled: ${e.payload.buttonDisabled ? 'YES' : 'NO'}, Reason: ${e.payload.disableReason || 'none'}`;
          break;
        case EVENT_TYPES.INPUT_EVENT_TRACE:
          label = `INPUT EVENT: ${String(e.payload.field).toUpperCase()} ${String(e.payload.event).toUpperCase()}`;
          description = `valuePresent: ${e.payload.valuePresent}, length: ${e.payload.valueLength} (trusted: ${e.payload.isTrusted})`;
          break;
        case EVENT_TYPES.BUTTON_CLICK_ATTEMPT:
          label = 'BUTTON CLICK ATTEMPT';
          description = e.payload.blockedByDisabledState ? 'CLICK_BLOCKED_BY_DISABLED_STATE' : 'Button clicked';
          break;
        case EVENT_TYPES.CLICK_BLOCKED_BY_DISABLED_STATE:
          label = 'CLICK BLOCKED BY DISABLED STATE';
          description = e.payload.reason || 'Button is disabled in DOM';
          break;
        case EVENT_TYPES.FORM_SUBMIT_ATTEMPT:
          label = 'FORM SUBMIT ATTEMPT';
          description = `submitFired: ${e.payload.submitFired}`;
          break;
        case EVENT_TYPES.LOGIN_ACTION:
          label = 'LOGIN SUBMITTED';
          description = `Trigger: ${e.payload.trigger} (${e.payload.submitterType})`;
          break;
        case EVENT_TYPES.REQUEST_STARTED:
          label = 'AUTH REQUEST STARTED';
          description = `${e.payload.method} ${e.payload.path || e.payload.url || ''}`;
          break;
        case EVENT_TYPES.RESPONSE:
        case EVENT_TYPES.REQUEST_COMPLETED:
          label = 'AUTH RESPONSE RECEIVED';
          description = `HTTP ${e.payload.status} in ${e.payload.duration || 0}ms`;
          break;
        case EVENT_TYPES.REDIRECT:
          label = 'AUTH REDIRECT';
          description = `${e.payload.originalUrl} -> ${e.payload.redirectUrl}`;
          break;
        case EVENT_TYPES.CHALLENGE_DETECTED:
          label = 'SECURITY CHALLENGE REQUIRED';
          description = `${e.payload.challengeType}: ${e.payload.description || ''}`;
          break;
        case EVENT_TYPES.SESSION_STATE_CHANGE:
        case EVENT_TYPES.AUTHENTICATED_STATE:
          label = 'SESSION STATE OBSERVED';
          description = e.payload.authenticatedState ? 'Authenticated state established' : 'No authenticated state';
          break;
        case EVENT_TYPES.NETWORK_ERROR:
          label = 'NETWORK ERROR DETECTED';
          description = `${e.payload.errorType}: ${e.payload.message}`;
          break;
        default:
          label = e.type;
          description = JSON.stringify(e.payload || {});
      }

      return {
        time: timeStr,
        timestamp: e.timestamp,
        label,
        description,
        formatted: `${timeStr}  ${label}${description ? ' — ' + description : ''}`
      };
    });
  }

  /**
   * Generates a terminal-formatted diagnostic readout for logs or developer consoles.
   */
  static formatPanelReadout(report) {
    const p = report.pipeline;
    const sym = (val) => val === '✓' ? '[✓]' : (val === '✕' ? '[✕]' : '[ ]');
    const tableSym = (val) => val || '-';

    const dom = report.domInspection || {};
    const app = report.appStateComparison || { username: {}, password: {} };
    const val = report.validationInspection || {};
    const clk = report.clickInspection || {};
    const sub = report.formSubmission || {};
    const net = report.networkInspection || {};
    const brg = report.bridgeInspection || {};
    const tgt = report.targetInspection || {};

    const chk = report.checklist || {};
    const fChk = chk.form || {};
    const bChk = chk.button || {};
    const sChk = chk.state || {};

    const lines = [
      '============================================================',
      '              AUTHENTICATION DIAGNOSTIC PANEL               ',
      '                         AUTH TRACE                         ',
      '============================================================',
      `${sym(p.dom.status)} DOM values detected`,
      `${sym(p.appState.status)} Application state detected`,
      `${sym(p.validation.status)} Form validation`,
      `${sym(p.button.status)} Login button`,
      `${sym(p.click.status)} Click`,
      `${sym(p.submit.status)} Submit`,
      `${sym(p.network.status)} Network`,
      `${sym(p.bridge.status)} Bridge`,
      `${sym(p.target.status)} Target`,
      `${sym(p.session.status)} Session`,
      '',
      '------------------------------------------------------------',
      `DOM                 ${tableSym(p.dom.status)}`,
      `APP STATE           ${tableSym(p.appState.status)}`,
      `VALIDATION          ${tableSym(p.validation.status)}`,
      `BUTTON              ${tableSym(p.button.status)}`,
      `CLICK               ${tableSym(p.click.status)}`,
      `SUBMIT              ${tableSym(p.submit.status)}`,
      `NETWORK             ${tableSym(p.network.status)}`,
      `BRIDGE              ${tableSym(p.bridge.status)}`,
      `TARGET              ${tableSym(p.target.status)}`,
      `SESSION             ${tableSym(p.session.status)}`,
      '------------------------------------------------------------',
      'FIRST FAILURE:',
      `${report.firstFailure || 'NONE (AUTH_SUCCESS)'}`,
      '',
      'REASON:',
      `${report.firstFailureReason || report.reason}`,
      '------------------------------------------------------------',
      'STEP 1 — DOM',
      `  usernamePresent:   ${dom.usernamePresent}`,
      `  passwordPresent:   ${dom.passwordPresent}`,
      `  usernameLength:    ${dom.usernameLength}`,
      `  passwordLength:    ${dom.passwordLength}`,
      `  inputType:         ${dom.inputType}`,
      `  name:              ${dom.name}`,
      `  id:                ${dom.id}`,
      `  autocomplete:      ${dom.autocomplete}`,
      `  required:          ${dom.required}`,
      `  disabled:          ${dom.disabled}`,
      '',
      'STEP 2 — APPLICATION STATE',
      '  USERNAME',
      `    DOM:        ${app.username ? app.username.dom : 'UNKNOWN'}`,
      `    APP STATE:  ${app.username ? app.username.appState : 'UNKNOWN'}`,
      '  PASSWORD',
      `    DOM:        ${app.password ? app.password.dom : 'UNKNOWN'}`,
      `    APP STATE:  ${app.password ? app.password.appState : 'UNKNOWN'}`,
      '',
      'STEP 3 — VALIDATION',
      `  FORM VALID:       ${val.formValid}`,
      `  BUTTON DISABLED:  ${val.buttonDisabled}`,
      '  DISABLE REASON:',
      `  ${val.disableReason}`,
      '',
      'STEP 4 — CLICK EVENT',
      `  BUTTON_CLICK_ATTEMPT:            ${clk.buttonClickAttempt ? 'DETECTED' : 'NONE'}`,
      `  BUTTON_CLICK_HANDLER:            ${clk.buttonClickHandler}`,
      `  FORM_SUBMIT_ATTEMPT:             ${clk.formSubmitAttempt ? 'DETECTED' : 'NONE'}`,
      `  CLICK_BLOCKED_BY_DISABLED_STATE: ${clk.clickBlockedByDisabledState ? 'YES' : 'NO'}`,
      '',
      'STEP 5 — FORM SUBMISSION',
      '  FORM_SUBMIT:',
      `  ${sub.formSubmit}`,
      `  Reason: ${sub.reason}`,
      '',
      'STEP 6 — NETWORK',
      '  NETWORK_REQUEST:',
      `  ${net.networkRequest}`,
      ...(net.networkRequest === 'STARTED' ? [
        `  REQUEST_URL:       ${net.requestUrl}`,
        `  REQUEST_METHOD:    ${net.requestMethod}`,
        `  REQUEST_STATUS:    ${net.requestStatus || 'PENDING'}`,
        `  REQUEST_DURATION:  ${net.requestDuration !== null ? net.requestDuration + 'ms' : 'PENDING'}`
      ] : []),
      '',
      'STEP 7 — BRIDGE',
      '  BRIDGE_STATUS:',
      `  ${brg.bridgeStatus}`,
      '',
      'STEP 8 — TARGET',
      '  TARGET_STATUS:',
      `  ${tgt.targetStatus !== null ? tgt.targetStatus : (tgt.targetRequestStarted ? 'PENDING' : 'NOT_DISPATCHED')}`,
      '------------------------------------------------------------',
      'FLOW STATUS CHECKLIST:',
      `  Username detected          ${fChk.usernameDetected ? '✓' : '✕'}`,
      `  Password detected          ${fChk.passwordDetected ? '✓' : '✕'}`,
      `  Username valid             ${fChk.usernameValid ? '✓' : '✕'}`,
      `  Password valid          ${fChk.passwordValid ? '✓' : '✕'}`,
      `  Form valid              ${fChk.formValid ? '✓' : '✕'}`,
      `  Login disabled          ${bChk.loginDisabled ? '✓' : '✕'}`,
      `  Disable reason          ${bChk.disableReason || 'NONE'}`,
      `  DOM ↔ APP STATE         ${sChk.domAppStateSynced ? '✓' : '✕'}`,
      `  Form detected              ${report.checklist.formDetected ? '✓' : '✕'}`,
      `  Login action detected      ${report.checklist.loginActionDetected ? '✓' : '✕'}`,
      `  Request generated          ${report.checklist.requestGenerated ? '✓' : '✕'}`,
      `  Target responded           ${report.checklist.targetResponded ? '✓' : '✕'}`,
      `  HTTP status                ${report.checklist.httpStatus !== null && report.checklist.httpStatus !== undefined ? report.checklist.httpStatus : 'N/A'}`,
      `  Session established        ${report.checklist.sessionEstablished ? '✓' : '✕'}`,
      `  Authenticated UI           ${report.checklist.authenticatedUi ? '✓' : '✕'}`,
      '------------------------------------------------------------',
      `RESULT:                    ${report.classification}`,
      `FAILURE LAYER:             ${report.failureLayer}`
    ];

    if (report.timeline && report.timeline.length > 0) {
      lines.push('------------------------------------------------------------');
      lines.push('CHRONOLOGICAL TIMELINE:');
      for (const entry of report.timeline) {
        lines.push(`  ${entry.formatted || `${entry.time}  ${entry.label}`}`);
      }
    }

    if (report.typingTest) {
      const tt = report.typingTest;
      lines.push('------------------------------------------------------------');
      lines.push('MANUAL TYPING VS AUTOFILL TEST COMPARISON:');
      if (tt.manual) {
        lines.push(`  MANUAL:   DOM: ${tt.manual.domValue ? '✓' : '✕'} | App: ${tt.manual.appState ? '✓' : '✕'} | Valid: ${tt.manual.formValid ? '✓' : '✕'} | Enabled: ${tt.manual.buttonEnabled ? '✓' : '✕'}`);
      }
      if (tt.autofill) {
        lines.push(`  AUTOFILL: DOM: ${tt.autofill.domValue ? '✓' : '✕'} | App: ${tt.autofill.appState ? '✓' : '✕'} | Valid: ${tt.autofill.formValid ? '✓' : '✕'} | Enabled: ${tt.autofill.buttonEnabled ? '✓' : '✕'}`);
      }
      if (tt.comparisonSummary) {
        lines.push(`  SUMMARY:  ${tt.comparisonSummary}`);
      }
    }

    lines.push('============================================================');
    return lines.join('\n');
  }
}

module.exports = {
  AuthDiagnosticsEngine,
  AUTH_CLASSIFICATION,
  FIRST_FAILURE,
  FAILURE_LAYER
};
