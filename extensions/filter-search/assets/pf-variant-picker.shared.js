/**
 * Pure helpers for choosing and matching Storefront product variants.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.AcoPFVariantPicker = api;
})(
  typeof self !== "undefined"
    ? self
    : typeof global !== "undefined"
      ? global
      : this,
  function () {
  function createDictionary() {
    return Object.create(null);
  }

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function selectedOptionMap(variant) {
    var map = createDictionary();
    var options = (variant && variant.selectedOptions) || [];
    for (var i = 0; i < options.length; i++) {
      var option = options[i] || {};
      if (option.name == null) continue;
      map[String(option.name)] = option.value == null ? "" : String(option.value);
    }
    return map;
  }

  function optionGroups(variants, optionNames) {
    var groups = [];
    var seenByName = createDictionary();
    var list = variants || [];
    var orderedNames = optionNames || [];

    for (var i = 0; i < orderedNames.length; i++) {
      groups.push({ name: orderedNames[i], values: [] });
      seenByName[orderedNames[i]] = createDictionary();
    }

    for (var v = 0; v < list.length; v++) {
      var map = selectedOptionMap(list[v]);
      for (var g = 0; g < orderedNames.length; g++) {
        var name = orderedNames[g];
        if (!hasOwn(map, name)) continue;
        var value = map[name];
        if (seenByName[name][value]) continue;
        seenByName[name][value] = true;
        groups[g].values.push(value);
      }
    }

    return groups;
  }

  function variantKey(variant) {
    var map = selectedOptionMap(variant);
    var names = Object.keys(map).sort();
    var parts = [];
    for (var i = 0; i < names.length; i++) {
      parts.push(names[i] + "\u0000" + map[names[i]]);
    }
    return parts.join("\u0001");
  }

  function matchingVariant(variants, selection) {
    var list = variants || [];
    var required = selection || createDictionary();
    var requiredNames = Object.keys(required);

    for (var i = 0; i < list.length; i++) {
      var variant = list[i] || {};
      if (variant.availableForSale !== true) continue;
      var map = selectedOptionMap(variant);
      var keys = Object.keys(map);
      if (keys.length !== requiredNames.length) continue;
      var matches = true;
      for (var j = 0; j < requiredNames.length; j++) {
        var name = requiredNames[j];
        if (!hasOwn(map, name) || !hasOwn(required, name) || map[name] !== required[name]) {
          matches = false;
          break;
        }
      }
      if (matches) return variant;
    }

    return null;
  }

  function selectionWithValue(selection, name, value) {
    var next = createDictionary();
    var current = selection || createDictionary();
    var names = Object.keys(current);
    for (var i = 0; i < names.length; i++) {
      next[names[i]] = current[names[i]];
    }
    next[String(name)] = String(value);
    return next;
  }

  function optionValueAvailable(variants, selection, name, value, optionNames) {
    var next = selectionWithValue(selection, name, value);
    var orderedNames = optionNames || [];
    var optionIndex = orderedNames.indexOf(String(name));
    if (optionIndex < 0) return !!matchingVariant(variants, next);

    var relevantNames = orderedNames.slice(0, optionIndex + 1);
    var list = variants || [];
    for (var i = 0; i < list.length; i++) {
      var variant = list[i] || {};
      if (variant.availableForSale !== true) continue;
      var map = selectedOptionMap(variant);
      var matches = true;
      for (var j = 0; j < relevantNames.length; j++) {
        var optionName = relevantNames[j];
        if (!hasOwn(map, optionName) || map[optionName] !== next[optionName]) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
    return false;
  }

  function parseQuantity(value) {
    var text = value == null ? "" : String(value);
    if (!/^[0-9]+$/.test(text)) return null;
    var quantity = Number(text);
    if (
      !Number.isInteger(quantity) ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      return null;
    }
    return quantity;
  }

  function firstAvailableVariant(variants) {
    var list = variants || [];
    for (var i = 0; i < list.length; i++) {
      if ((list[i] || {}).availableForSale === true) return list[i];
    }
    return null;
  }

  return {
    optionGroups: optionGroups,
    firstAvailableVariant: firstAvailableVariant,
    matchingVariant: matchingVariant,
    optionValueAvailable: optionValueAvailable,
    parseQuantity: parseQuantity,
    variantKey: variantKey,
  };
});
