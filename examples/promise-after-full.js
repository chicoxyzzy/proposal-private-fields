(function() { "use strict";

// Find global variable and exit if Promise is defined on it

var Global = (function() {
    if (typeof window !== "undefined" && window && window.window === window)
        return window;
    if (typeof global !== "undefined" && global && global.global === global)
        return global;
    throw new Error("Unable to determine global object");
})();

if (typeof Global.Promise === "function")
    return;

// Create an efficient microtask queueing mechanism

var runLater = (function() {
    // Node
    if (Global.process && typeof process.version === "string") {
        return Global.setImmediate ?
            function(fn) { setImmediate(fn); } :
            function(fn) { process.nextTick(fn); };
    }

    // Newish Browsers
    var Observer = Global.MutationObserver || Global.WebKitMutationObserver;

    if (Observer) {
        var div = document.createElement("div"),
            queuedFn = void 0;

        var observer = new Observer(function() {
            var fn = queuedFn;
            queuedFn = void 0;
            fn();
        });

        observer.observe(div, { attributes: true });

        return function(fn) {
            if (queuedFn !== void 0)
                throw new Error("Only one function can be queued at a time");
            queuedFn = fn;
            div.classList.toggle("x");
        };
    }

    // Fallback
    return function(fn) { setTimeout(fn, 0); };
})();

var EnqueueMicrotask = (function() {
    var queue = null;

    function flush() {
        var q = queue;
        queue = null;
        for (var i = 0; i < q.length; ++i)
            q[i]();
    }

    return function PromiseEnqueueMicrotask(fn) {
        // fn must not throw
        if (!queue) {
            queue = [];
            runLater(flush);
        }
        queue.push(fn);
    };
})();

// Mock V8 internal functions and vars

function SET_PRIVATE(obj, prop, val) { obj[prop] = val; }
function GET_PRIVATE(obj, prop) { return obj[prop]; }
function IS_SPEC_FUNCTION(obj) { return typeof obj === "function"; }
function IS_SPEC_OBJECT(obj) { return obj === Object(obj); }
function HAS_DEFINED_PRIVATE(obj, prop) { return prop in obj; }
function IS_UNDEFINED(x) { return x === void 0; }
function MakeTypeError(msg) { return new TypeError(msg); }

// In IE8 Object.defineProperty only works on DOM nodes, and defineProperties does not exist
var _defineProperty = Object.defineProperties && Object.defineProperty;

function AddNamedProperty(target, name, value) {
    if (!_defineProperty) {
        target[name] = value;
        return;
    }

    _defineProperty(target, name, {
        configurable: true,
        writable: true,
        enumerable: false,
        value: value
    });
}

function InstallFunctions(target, attr, list) {
    for (var i = 0; i < list.length; i += 2)
        AddNamedProperty(target, list[i], list[i + 1]);
}

var IsArray = Array.isArray || (function(obj) {
    var str = Object.prototype.toString;
    return function(obj) { return str.call(obj) === "[object Array]" };
})();

var UNDEFINED, DONT_ENUM, InternalArray = Array;


class Promise {

    const OPTIMIZED = {};
    const PENDING = 0;
    const RESOLVED = +1;
    const REJECTED = -1;

    @status = PENDING;
    @value;
    @onResolve;
    @onReject;
    @hasHandler = false;

    constructor(resolver) {

        // Optimized case to avoid creating an uneccessary closure.  Creator assumes
        // responsibility for setting initial state.
        if (resolver === OPTIMIZED)
            return;

        if (!IS_SPEC_FUNCTION(resolver))
            throw MakeTypeError('resolver_not_a_function', [resolver]);

        @onResolve = new InternalArray;
        @onReject = new InternalArray;

        try { resolver(x => { this::_resolve(x) }, r => { this::_reject(r) }) }
        catch (e) { this::_reject(e) }
    }

    chain(onResolve, onReject) {

        return this::_chain(onResolve, onReject);
    }

    then(onResolve, onReject) {

        onResolve = IS_SPEC_FUNCTION(onResolve) ? onResolve : _idResolveHandler;
        onReject = IS_SPEC_FUNCTION(onReject) ? onReject : _idRejectHandler;

        var constructor = this.constructor;

        return this::_chain(x => {

            x = _coerce(constructor, x);

            return x === this ? onReject(MakeTypeError('promise_cyclic', [x])) :
                _isPromise(x) ? x.then(onResolve, onReject) :
                onResolve(x);

        }, onReject);
    }

    catch(onReject) {

        return this.then(void 0, onReject);
    }

    static defer() {

        return this::_deferred();
    }

    static accept(x) {

        return this::_accepted(e);
    }

    static reject(e) {

        return this::_rejected(e);
    }

    static resolve(x) {

        return _isPromise(x) ? x : new this(resolve => resolve(x));
    }

    static all(values) {

        var deferred = this::_deferred(),
            resolutions = [];

        if (!IsArray(values)) {

            deferred.reject(MakeTypeError('invalid_argument'));
            return deferred.promise;
        }

        function makeResolver(i) {

            return x => {

                resolutions[i] = x;

                if (--count === 0)
                    deferred.resolve(resolutions);
            };
        }

        try {

            var count = values.length;

            if (count === 0) {

                deferred.resolve(resolutions);

            } else {

                for (var i = 0; i < values.length; ++i) {

                    this.resolve(values[i]).then(
                        makeResolver(i),
                        deferred.reject);
                }
            }

        } catch (e) {

            deferred.reject(e);
        }

        return deferred.promise;
    }

    static one(values) {

        var deferred = this::_deferred(this);

        if (!IsArray(values)) {

            deferred.reject(MakeTypeError('invalid_argument'));
            return deferred.promise;
        }

        try {

            for (var i = 0; i < values.length; ++i) {

                this.resolve(values[i]).then(
                    deferred.resolve,
                    deferred.reject);
            }

        } catch (e) {

            deferred.reject(e);
        }

        return deferred.promise;
    }

    // === Private Implementation ===

    function _resolve(x) {

        this::_done(RESOLVED, x, @onResolve);
    }

    function _reject(r) {

        this::_done(REJECTED, r, @onReject);
    }

    function _done(status, value, queue) {

        if (@status === PENDING) {

            @status = status;
            @value = value;

            _enqueue(value, queue, status);
        }
    }

    function _coerce(constructor, x) {

        if (!_isPromise(x) && IS_SPEC_OBJECT(x)) {

            var then;

            try { then = x.then }
            catch(r) { return constructor::_rejected(r) }

            if (IS_SPEC_FUNCTION(then)) {

                var deferred = constructor::_deferred();

                try { x::then(deferred.resolve, deferred.reject) }
                catch(r) { deferred.reject(r) }

                return deferred.promise;
            }
        }

        return x;
    }

    function _enqueue(value, tasks, status) {

        EnqueueMicrotask(_=> {

            for (var i = 0; i < tasks.length; i += 2)
                _handle(value, tasks[i], tasks[i + 1]);
        });
    }

    function _handle(value, handler, deferred) {

        try {

            var result = handler(value);

            if (result === deferred.promise)
                throw MakeTypeError('promise_cyclic', [result]);
            else if (_isPromise(result))
                result::_chain(deferred.resolve, deferred.reject);
            else
                deferred.resolve(result);

        } catch (e) {

            try { deferred.reject(e) }
            catch (e) { }
        }
    }

    function _idResolveHandler(x) { return x }

    function _idRejectHandler(r) { throw r }

    function _noopResolver() { }

    function _isPromise(x) {

        try { return x.@status !== void 0 }
        catch (e) { return false }
    }

    function _deferred() {

        if (this === Promise) {

            var promise = new Promise(OPTIMIZED);

            promise.@onResolve = new InternalArray;
            promise.@onReject = new InternalArray;

            return {

                promise: promise,
                resolve: x => { promise::_resolve(x) },
                reject: r => { promise::_reject(r) },
            };

        } else {

            var result = {};

            result.promise = new this((resolve, reject) => {

                result.resolve = resolve;
                result.reject = reject;
            });

            return result;
        }
    }

    function _accepted(x) {

        if (this === Promise) {

            var promise = new Promise(OPTIMIZED);
            promise.@state = RESOLVED;
            promise.@value = x;
            return promise;
        }

        return new this(resolve => resolve(x));
    }

    function _rejected(r) {

        if (this === Promise) {

            var promise = new Promise(OPTIMIZED);
            promise.@status = REJECTED;
            promise.@value = r;
            return promise;
        }

        return new this((resolve, reject) => reject(r));
    }

    function _chain(onResolve, onReject) {

        onResolve = IS_UNDEFINED(onResolve) ? _idResolveHandler : onResolve;
        onReject = IS_UNDEFINED(onReject) ? _idRejectHandler : onReject;

        var deferred = this.constructor::_deferred();

        switch (@status) {

            case PENDING:
                @onResolve.push(onResolve, deferred);
                @onReject.push(onReject, deferred);
                break;

            case RESOLVED:  // Resolved
                _enqueue(@value, [onResolve, deferred], RESOLVED);
                break;

            case REJECTED:  // Rejected
                _enqueue(@value, [onReject, deferred], REJECTED);
                break;
        }

        // Mark this promise as having handler.
        @hasHandler = true;

        return deferred.promise;
    }

}


AddNamedProperty(Global, 'Promise', Promise, DONT_ENUM);

})();
