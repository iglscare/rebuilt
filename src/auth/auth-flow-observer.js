/**
 * REBUILT — Phase 1: Authentication Flow Observer
 * 
 * Captures SAFE metadata only during browser login attempts.
 * Redacts passwords, tokens, cookies, authorization headers, and secrets unconditionally.
 * 
 * Tracked lifecycle events:
 * - FORM_DETECTED
 * - LOGIN_ACTION
 * - REQUEST_STARTED
 * - REQUEST_COMPLETED
 * - REDIRECT
 * - RESPONSE
 * - CHALLENGE_DETECTED
 * - SESSION_STATE_CHANGE
 * - AUTHENTICATED_STATE
 * - NETWORK_ERROR
 */

const SENSITIVE_KEY_REGEX = /(password|pass|pwd|secret|credential|token|access_token|refresh_token|id_token|auth|authorization|cookie|set-cookie|session|csrf|xsrf|api[-_]?key)/i;

const SAFE_HEADERS_WHITELIST = new Set([
  'content-type',
  'accept',
  'origin',
  'referer',
  'content-length',
  'cache-control',
  'x-requested-with',
  'user-agent',
  'location'
]);

/**
 * Strips sensitive query parameters from URLs and returns a clean URL string.
 */
function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl, 'https://rebuilt.local');
    const params = new URLSearchParams(parsed.search);
    for (const key of Array.from(params.keys())) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        params.set(key, '[REDACTED]');
      }
    }
    parsed.search = params.toString();
    // If parsed using dummy base, return relative or original pathname
    if (parsed.origin === 'https://rebuilt.local' && !rawUrl.startsWith('https://rebuilt.local')) {
      return parsed.pathname + (parsed.search ? '?' + parsed.search : '') + parsed.hash;
    }
    return parsed.toString();
  } catch (_) {
    return rawUrl.split('?')[0];
  }
}

/**
 * Filters headers to only include safe non-sensitive headers.
 */
function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const clean = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SAFE_HEADERS_WHITELIST.has(lowerKey)) {
      clean[lowerKey] = String(value);
    } else if (SENSITIVE_KEY_REGEX.test(lowerKey)) {
      clean[lowerKey] = '[REDACTED]';
    }
  }
  return clean;
}

/**
 * Deep redaction helper for any arbitrary object.
 */
function redactObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactObject);

  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      clean[key] = '[REDACTED]';
    } else if (val && typeof val === 'object') {
      clean[key] = redactObject(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

const EVENT_TYPES = {
  FORM_DETECTED: 'FORM_DETECTED',
  FORM_INSPECTION: 'FORM_INSPECTION',
  INPUT_EVENT_TRACE: 'INPUT_EVENT_TRACE',
  TEST_MANUAL_TYPING: 'TEST_MANUAL_TYPING',
  BUTTON_CLICK_ATTEMPT: 'BUTTON_CLICK_ATTEMPT',
  CLICK_BLOCKED_BY_DISABLED_STATE: 'CLICK_BLOCKED_BY_DISABLED_STATE',
  FORM_SUBMIT_ATTEMPT: 'FORM_SUBMIT_ATTEMPT',
  LOGIN_ACTION: 'LOGIN_ACTION',
  REQUEST_STARTED: 'REQUEST_STARTED',
  REQUEST_COMPLETED: 'REQUEST_COMPLETED',
  RESPONSE: 'RESPONSE',
  REDIRECT: 'REDIRECT',
  CHALLENGE_DETECTED: 'CHALLENGE_DETECTED',
  SESSION_STATE_CHANGE: 'SESSION_STATE_CHANGE',
  AUTHENTICATED_STATE: 'AUTHENTICATED_STATE',
  NETWORK_ERROR: 'NETWORK_ERROR'
};

class AuthenticationFlowObserver {
  constructor() {
    // Map of cloneId -> Array of observed events
    this.eventsByClone = new Map();
    // Map of cloneId -> Current diagnostic state
    this.stateByClone = new Map();
  }

  /**
   * Clears or initializes observation for a clone.
   */
  reset(cloneId) {
    if (!cloneId) return;
    this.eventsByClone.set(cloneId, []);
    this.stateByClone.set(cloneId, {
      formDetected: false,
      loginActionDetected: false,
      clickAttemptDetected: false,
      clickBlockedByDisabledState: false,
      submitAttemptDetected: false,
      submitFired: false,
      requestGenerated: false,
      targetResponded: false,
      lastHttpStatus: null,
      redirectDetected: false,
      sessionEstablished: false,
      authenticatedUi: false,
      challengeDetected: false,
      networkError: null,
      lastRequest: null,
      lastResponse: null,
      inspection: null,
      inputEvents: [],
      typingTest: null
    });
  }

  getState(cloneId) {
    if (!this.stateByClone.has(cloneId)) {
      this.reset(cloneId);
    }
    return this.stateByClone.get(cloneId);
  }

  getEvents(cloneId) {
    return this.eventsByClone.get(cloneId) || [];
  }

  /**
   * Internal recorder that logs a timestamped event into the clone's timeline.
   */
  _record(cloneId, type, payload = {}) {
    if (!cloneId) return null;
    if (!this.eventsByClone.has(cloneId)) {
      this.reset(cloneId);
    }

    const state = this.getState(cloneId);
    const timestamp = Date.now();
    const event = {
      type,
      timestamp,
      isoTime: new Date(timestamp).toISOString(),
      payload: redactObject(payload)
    };

    this.eventsByClone.get(cloneId).push(event);
    return event;
  }

  /**
   * 1. FORM DETECTION
   * Detects login forms (username, password, submit button).
   * Strictly records boolean attributes and never credentials.
   */
  recordFormDetected(cloneId, data = {}) {
    const state = this.getState(cloneId);
    const formMeta = {
      detected: Boolean(data.detected !== false),
      usernameField: Boolean(data.usernameField || data.hasUsername),
      passwordField: Boolean(data.passwordField || data.hasPassword),
      submitControl: Boolean(data.submitControl || data.hasSubmit),
      action: data.action ? sanitizeUrl(data.action) : '',
      method: (data.method || 'POST').toUpperCase()
    };

    if (formMeta.detected) {
      state.formDetected = true;
    }

    return this._record(cloneId, EVENT_TYPES.FORM_DETECTED, formMeta);
  }

  /**
   * 1b. FORM & BUTTON DEEP INSPECTION
   * Inspects actual inputs, login button, HTML5 validation, DOM vs App state, and exact disable condition.
   * Strictly records SAFE metadata only (never passwords).
   */
  recordFormInspection(cloneId, data = {}) {
    const state = this.getState(cloneId);
    state.formDetected = true;

    const safeInputs = {};
    if (data.inputs) {
      for (const [key, inp] of Object.entries(data.inputs)) {
        if (!inp) continue;
        safeInputs[key] = {
          tag: inp.tag || 'INPUT',
          type: inp.type || 'text',
          name: inp.name || '',
          id: inp.id || '',
          autocomplete: inp.autocomplete || '',
          required: Boolean(inp.required),
          disabled: Boolean(inp.disabled),
          readOnly: Boolean(inp.readOnly || inp.readonly),
          ariaAttributes: inp.ariaAttributes || {},
          valuePresent: Boolean(inp.valuePresent),
          valueLength: typeof inp.valueLength === 'number' ? inp.valueLength : 0,
          valid: Boolean(inp.valid !== false),
          validity: inp.validity || {},
          validationMessage: inp.validationMessage ? String(inp.validationMessage).slice(0, 200) : '',
          frameworkState: inp.frameworkState ? {
            detected: Boolean(inp.frameworkState.detected),
            type: inp.frameworkState.type || 'none',
            appValuePresent: Boolean(inp.frameworkState.appValuePresent),
            appValueLength: typeof inp.frameworkState.appValueLength === 'number' ? inp.frameworkState.appValueLength : 0,
            isSynced: inp.frameworkState.isSynced,
            details: inp.frameworkState.details ? String(inp.frameworkState.details).slice(0, 200) : ''
          } : null
        };
      }
    }

    const safeButton = data.button ? {
      tag: data.button.tag || 'BUTTON',
      type: data.button.type || 'submit',
      disabled: Boolean(data.button.disabled),
      hasDisabledAttr: Boolean(data.button.hasDisabledAttr),
      ariaDisabled: data.button.ariaDisabled || null,
      isAriaDisabled: Boolean(data.button.isAriaDisabled),
      className: data.button.className || '',
      formAssociation: data.button.formAssociation || null,
      closestForm: data.button.closestForm || null,
      hasClickHandler: Boolean(data.button.hasClickHandler),
      reactPropsDisabled: data.button.reactPropsDisabled
    } : null;

    // Derive validation state
    const uValid = safeInputs.username ? Boolean(safeInputs.username.valid !== false) : true;
    const pValid = safeInputs.password ? Boolean(safeInputs.password.valid !== false) : true;
    let defaultFormValid = uValid && pValid;
    if (data.disableReason && (data.disableReason.includes('PASSWORD_TOO_SHORT') || data.disableReason.includes('VALIDATION_FAILED'))) {
      defaultFormValid = false;
    }

    // Derive state synchronization
    const uSynced = safeInputs.username && safeInputs.username.frameworkState ? safeInputs.username.frameworkState.isSynced !== false : true;
    const pSynced = safeInputs.password && safeInputs.password.frameworkState ? safeInputs.password.frameworkState.isSynced !== false : true;
    let defaultOverallSynced = uSynced && pSynced;
    if (data.disableReason && data.disableReason.includes('STATE_SYNCHRONIZATION_FAILURE')) {
      defaultOverallSynced = false;
    }

    const inspection = {
      inputs: safeInputs,
      button: safeButton,
      validation: data.validation || {
        formCheckValidity: defaultFormValid,
        usernameValid: uValid,
        passwordValid: pValid,
        formValid: defaultFormValid,
        reasons: []
      },
      stateSync: data.stateSync || {
        usernameSynced: uSynced,
        passwordSynced: pSynced,
        overallSynced: defaultOverallSynced
      },
      buttonDisabled: Boolean(data.buttonDisabled || (safeButton && safeButton.disabled)),
      disableReason: data.disableReason || 'BUTTON_NOT_DISABLED',
      inspectedAt: Date.now()
    };

    state.inspection = inspection;
    return this._record(cloneId, EVENT_TYPES.FORM_INSPECTION, inspection);
  }

  /**
   * 1c. INPUT EVENT TRACE
   * Records input interactions (focus, input, change, blur, keydown, keyup) with safe metadata.
   */
  recordInputEvent(cloneId, data = {}) {
    const state = this.getState(cloneId);
    const traceItem = {
      field: data.field || 'unknown',
      event: data.event || 'input',
      timestamp: data.timestamp || Date.now(),
      valuePresent: Boolean(data.valuePresent),
      valueLength: typeof data.valueLength === 'number' ? data.valueLength : 0,
      isTrusted: Boolean(data.isTrusted !== false)
    };

    if (!state.inputEvents) state.inputEvents = [];
    state.inputEvents.push(traceItem);
    if (state.inputEvents.length > 50) state.inputEvents.shift();

    return this._record(cloneId, EVENT_TYPES.INPUT_EVENT_TRACE, traceItem);
  }

  /**
   * 1d. MANUAL TYPING VS AUTOFILL TEST COMPARISON
   */
  recordManualTypingTest(cloneId, data = {}) {
    const state = this.getState(cloneId);
    const testResult = {
      manual: data.manual || { domValue: true, appState: true, formValid: true, buttonEnabled: true },
      autofill: data.autofill || { domValue: true, appState: false, formValid: false, buttonEnabled: false },
      comparisonSummary: data.comparisonSummary || 'Autofill fails to synchronize with application state.',
      timestamp: Date.now()
    };

    state.typingTest = testResult;
    return this._record(cloneId, EVENT_TYPES.TEST_MANUAL_TYPING, testResult);
  }

  /**
   * 2. LOGIN ACTION DETECTION
   * When user clicks submit or presses Enter in login form.
   */
  recordLoginAction(cloneId, data = {}) {
    const state = this.getState(cloneId);
    state.loginActionDetected = true;

    return this._record(cloneId, EVENT_TYPES.LOGIN_ACTION, {
      trigger: data.trigger || 'submit',
      formId: data.formId || null,
      submitterType: data.submitterType || 'button',
      clientTimestamp: data.clientTimestamp || Date.now()
    });
  }

  /**
   * 2b. BUTTON CLICK ATTEMPT
   * Tracks user click attempts on the login button, including when click is blocked by disabled state.
   */
  recordClickAttempt(cloneId, data = {}) {
    const state = this.getState(cloneId);
    state.clickAttemptDetected = true;
    if (data.blockedByDisabledState) {
      state.clickBlockedByDisabledState = true;
    }

    return this._record(cloneId, EVENT_TYPES.BUTTON_CLICK_ATTEMPT, {
      blockedByDisabledState: Boolean(data.blockedByDisabledState),
      buttonDisabled: Boolean(data.buttonDisabled),
      hasClickHandler: Boolean(data.hasClickHandler),
      clientTimestamp: data.clientTimestamp || Date.now()
    });
  }

  /**
   * 2c. CLICK BLOCKED BY DISABLED STATE
   */
  recordClickBlocked(cloneId, data = {}) {
    const state = this.getState(cloneId);
    state.clickBlockedByDisabledState = true;

    return this._record(cloneId, EVENT_TYPES.CLICK_BLOCKED_BY_DISABLED_STATE, {
      buttonTag: data.buttonTag || 'BUTTON',
      reason: data.reason || 'Button is disabled in DOM',
      clientTimestamp: data.clientTimestamp || Date.now()
    });
  }

  /**
   * 2d. FORM SUBMIT ATTEMPT
   */
  recordSubmitAttempt(cloneId, data = {}) {
    const state = this.getState(cloneId);
    state.submitAttemptDetected = true;
    state.submitFired = Boolean(data.submitFired);

    return this._record(cloneId, EVENT_TYPES.FORM_SUBMIT_ATTEMPT, {
      formId: data.formId || null,
      method: (data.method || 'POST').toUpperCase(),
      submitFired: Boolean(data.submitFired),
      clientTimestamp: data.clientTimestamp || Date.now()
    });
  }

  /**
   * 3. REQUEST DETECTION
   * When network request is initiated.
   * Method, origin, path, resourceType, duration.
   * Redacts sensitive query parameters, bodies, and authorization headers.
   */
  recordRequestStarted(cloneId, data = {}) {
    const state = this.getState(cloneId);
    state.requestGenerated = true;

    let origin = data.origin || '';
    let path = data.path || '';
    if (data.url && (!origin || !path)) {
      try {
        const u = new URL(data.url);
        origin = u.origin;
        path = u.pathname;
      } catch (_) {
        path = data.url;
      }
    }

    const reqData = {
      requestId: data.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      method: (data.method || 'GET').toUpperCase(),
      origin,
      path,
      sanitizedUrl: data.url ? sanitizeUrl(data.url) : `${origin}${path}`,
      resourceType: data.resourceType || 'fetch',
      startTime: data.startTime || Date.now(),
      headers: sanitizeHeaders(data.headers)
    };

    state.lastRequest = reqData;
    return this._record(cloneId, EVENT_TYPES.REQUEST_STARTED, reqData);
  }

  /**
   * 4. RESPONSE ANALYSIS
   * Captures response status, duration, safe headers.
   */
  recordResponse(cloneId, data = {}) {
    const state = this.getState(cloneId);
    state.targetResponded = true;
    state.lastHttpStatus = typeof data.status === 'number' ? data.status : parseInt(data.status, 10) || 0;

    let origin = data.origin || '';
    let path = data.path || '';
    if (data.url && (!origin || !path)) {
      try {
        const u = new URL(data.url);
        origin = u.origin;
        path = u.pathname;
      } catch (_) {
        path = data.url;
      }
    }

    const respData = {
      requestId: data.requestId || null,
      method: (data.method || 'POST').toUpperCase(),
      origin,
      path,
      sanitizedUrl: data.url ? sanitizeUrl(data.url) : `${origin}${path}`,
      status: state.lastHttpStatus,
      statusText: data.statusText || '',
      duration: typeof data.duration === 'number' ? data.duration : (data.startTime ? Date.now() - data.startTime : 0),
      contentType: data.contentType || '',
      headers: sanitizeHeaders(data.headers),
      isChallenge: Boolean(data.isChallenge),
      challengeType: data.challengeType || null,
      errorSnippet: data.errorSnippet ? String(data.errorSnippet).slice(0, 200) : null
    };

    state.lastResponse = respData;
    this._record(cloneId, EVENT_TYPES.RESPONSE, respData);
    return this._record(cloneId, EVENT_TYPES.REQUEST_COMPLETED, {
      requestId: respData.requestId,
      status: respData.status,
      duration: respData.duration
    });
  }

  /**
   * 5. REDIRECT TRACKING
   * Records safe redirect metadata (original URL, redirect URL, status code).
   */
  recordRedirect(cloneId, data = {}) {
    const state = this.getState(cloneId);
    state.redirectDetected = true;

    const redirectData = {
      originalUrl: sanitizeUrl(data.originalUrl),
      redirectUrl: sanitizeUrl(data.redirectUrl),
      status: data.status || 302,
      completed: data.completed !== false,
      chainStep: data.chainStep || 1
    };

    return this._record(cloneId, EVENT_TYPES.REDIRECT, redirectData);
  }

  /**
   * 6. SECURITY CHALLENGE DETECTION
   * Captures observable challenges (MFA, CAPTCHA, checkpoint, device verification).
   */
  recordChallenge(cloneId, data = {}) {
    const state = this.getState(cloneId);
    state.challengeDetected = true;

    return this._record(cloneId, EVENT_TYPES.CHALLENGE_DETECTED, {
      challengeType: data.challengeType || 'UNKNOWN_CHALLENGE', // MFA, CAPTCHA, CHECKPOINT, DEVICE_VERIFICATION
      provider: data.provider || 'target_security',
      detectedVia: data.detectedVia || 'response_body',
      description: data.description || 'Target security challenge required.'
    });
  }

  /**
   * 7. SESSION DETECTION & STATE CHANGE
   * Tracks observable UI & route changes after login attempt without inspecting cookies.
   */
  recordSessionStateChange(cloneId, data = {}) {
    const state = this.getState(cloneId);
    const established = Boolean(data.authenticatedState || data.dashboardVisible || data.logoutControlFound);

    if (established) {
      state.sessionEstablished = true;
      state.authenticatedUi = true;
    }

    const stateChange = {
      previousRoute: sanitizeUrl(data.previousRoute || ''),
      currentRoute: sanitizeUrl(data.currentRoute || ''),
      formDisappeared: Boolean(data.formDisappeared),
      dashboardVisible: Boolean(data.dashboardVisible),
      logoutControlFound: Boolean(data.logoutControlFound),
      authenticatedState: established,
      observableIndicators: Array.isArray(data.observableIndicators) ? data.observableIndicators : []
    };

    this._record(cloneId, EVENT_TYPES.SESSION_STATE_CHANGE, stateChange);
    if (established) {
      this._record(cloneId, EVENT_TYPES.AUTHENTICATED_STATE, { established: true });
    }
    return stateChange;
  }

  /**
   * 7b. AUTHENTICATED STATE
   * Direct shortcut to record verified authenticated state.
   */
  recordAuthenticatedState(cloneId, data = {}) {
    return this.recordSessionStateChange(cloneId, {
      authenticatedState: true,
      ...data
    });
  }

  /**
   * 8. NETWORK ERROR DETECTION
   * Captures network failure metadata (DNS, connection, TLS, CORS, timeout).
   */
  recordNetworkError(cloneId, data = {}) {
    const state = this.getState(cloneId);
    const errData = {
      errorType: data.errorType || 'NETWORK_FAILURE', // DNS_FAILURE, CONNECTION_FAILURE, TLS_FAILURE, CORS_FAILURE, TIMEOUT
      message: data.message || 'Network request failed',
      url: data.url ? sanitizeUrl(data.url) : '',
      method: (data.method || 'POST').toUpperCase()
    };

    state.networkError = errData;
    return this._record(cloneId, EVENT_TYPES.NETWORK_ERROR, errData);
  }
}

const authFlowObserver = new AuthenticationFlowObserver();

module.exports = {
  AuthenticationFlowObserver,
  authFlowObserver,
  EVENT_TYPES,
  sanitizeUrl,
  sanitizeHeaders,
  redactObject
};
