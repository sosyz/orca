#pragma once

#include <functional>
#include <memory>
#include <unordered_map>
#include <utility>

#include "RNOH/arkui/NativeNodeApi.h"

using Float = double;

namespace butter {
template <
  class Key,
  class Value,
  class Hash = std::hash<Key>,
  class KeyEqual = std::equal_to<Key>,
  class Allocator = std::allocator<std::pair<const Key, Value>>>
using map = std::unordered_map<Key, Value, Hash, KeyEqual, Allocator>;
}
