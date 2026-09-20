#include <algorithm>
#include <codecvt>
#include <functional>
#include <iomanip>
#include <iostream>
#include <locale>
#include <map>
#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

using Float = double;
using Tag = int;
struct Point { double x = 0, y = 0; };
struct Size { double width = 0, height = 0; };
struct EdgeInsets { double left = 0, top = 0; };
EdgeInsets operator-(EdgeInsets a, EdgeInsets b) { return {a.left-b.left,a.top-b.top}; }
struct AttributedString { struct Range { int location = 0, length = 0; }; };
std::string quoted(const std::string& text) { std::ostringstream out; out << std::quoted(text); return out.str(); }
namespace jsi {
struct Runtime {};
struct String { static std::string createFromUtf8(Runtime&, const std::string& text) { return text; } };
struct Object {
  std::map<std::string,std::string> properties;
  explicit Object(Runtime&) {}
  void setProperty(Runtime&, const char* key, const std::string& value) { properties[key] = quoted(value); }
  void setProperty(Runtime&, const char* key, bool value) { properties[key] = value ? "true" : "false"; }
  void setProperty(Runtime&, const char* key, int value) { properties[key] = std::to_string(value); }
  void setProperty(Runtime&, const char* key, const Object&) {}
};
using Value = Object;
}
namespace boost::locale::conv {
template<class To, class From> auto utf_to_utf(const std::basic_string<From>& value) {
  std::wstring_convert<std::codecvt_utf8_utf16<char16_t>,char16_t> converter;
  if constexpr (std::is_same_v<To,char16_t>) return converter.from_bytes(value);
  else return converter.to_bytes(value);
}
}
std::vector<std::function<void()>> deliveries;
std::vector<std::pair<int,int>> commandSelections;
jsi::Runtime runtime;
bool previewSupported = true;
struct DynamicArkUILoader { static bool getTextChangeEventFun() { return previewSupported; } };
namespace facebook::react {
using ::Float; using ::Point; using ::Size; using ::EdgeInsets; using ::AttributedString;
class TextInputEventEmitter {
public:
  /* METRICS */
  struct KeyPressMetrics { std::string text; int eventCount; };
  void onChange(const Metrics&) const;
  void dispatchTextInputEvent(const std::string&, const Metrics&, bool = false) const;
  void dispatchEvent(const std::string& name, std::function<jsi::Value(jsi::Runtime&)> callback) const {
    deliveries.push_back([name,callback]() {
      auto payload = callback(runtime);
      std::cout << "{\"text\":" << payload.properties.at("text");
      if (payload.properties.count("isComposing")) std::cout << ",\"isComposing\":" << payload.properties.at("isComposing");
      std::cout << "}\n";
    });
  }
  void onSelectionChange(const Metrics&) {}
  void onKeyPress(const KeyPressMetrics& value) {
    if (value.text.empty()) deliveries.push_back([] { std::cout << "{\"key\":\"Backspace\"}\n"; });
  }
};
/* PAYLOAD */
/* EMITTER_CHANGE */
/* EMITTER_DISPATCH */
}
struct ArkUINode {};
class TextInputComponentInstance;
struct Node : ArkUINode {
  bool m_hasRNSetTextContext = false;
  std::string m_textContent, nativeText;
  void setTextContent(const std::string& value) { m_hasRNSetTextContext = true; m_textContent = value; nativeText = value; }
  std::string getTextContent() { return nativeText; }
  struct Rect { Point origin; };
  Rect getTextContentRect() { return {}; }
};
struct TextInputNode : Node {
  TextInputComponentInstance* m_textInputNodeDelegate;
  void onChange(const std::string&,const std::string&);
};
struct TextAreaNode : Node {
  TextInputComponentInstance* m_textAreaNodeDelegate;
  void onChange(const std::string&,const std::string&);
};
namespace folly {
struct dynamic {
  std::string text; int number = 0; std::vector<dynamic> values;
  bool isArray() const { return !values.empty(); }
  size_t size() const { return values.size(); }
  const dynamic& operator[](size_t index) const { return values.at(index); }
  int asInt() const { return number; }
  std::string asString() const { return text; }
};
}
class TextInputComponentInstance {
public:
  TextInputNode m_textInputNode;
  TextAreaNode m_textAreaNode;
  bool m_multiline = false, m_inPreviewMode = false, m_willDeleteHandled = false, m_valueChanged = false;
  std::string m_content, m_extendStr, m_preEditContent;
  int m_nativeEventCount = 0, m_endOffset = 0, m_selectionLocation = 0, m_selectionLength = 0;
  int m_preEditSelectionStart = 0, m_preEditSelectionLen = 0, m_contentSizeWidth = 0, m_contentSizeHeight = 0;
  std::optional<int> m_selectionStart, m_selectionEnd;
  struct Layout { float pointScaleFactor = 1; EdgeInsets contentInsets, borderWidth; struct Frame { Size size; } frame; } m_layoutMetrics;
  struct Props { struct Traits { bool showSoftInputOnFocus = true, selectTextOnFocus = false; } traits; };
  std::shared_ptr<Props> m_props = std::make_shared<Props>();
  std::shared_ptr<facebook::react::TextInputEventEmitter> m_eventEmitter = std::make_shared<facebook::react::TextInputEventEmitter>();
  TextInputComponentInstance() { m_textInputNode.m_textInputNodeDelegate = this; m_textAreaNode.m_textAreaNodeDelegate = this; }
  void focus() {} void blur() {}
  void onChange(ArkUINode*,const std::string&,std::string);
  void onChange(const std::string&,const std::string&) {}
  void onCommandReceived(const std::string&,const folly::dynamic&);
  facebook::react::TextInputEventEmitter::Metrics getTextInputMetrics();
  int countUtf16Characters(const std::string& value) { return boost::locale::conv::utf_to_utf<char16_t>(value).size(); }
  void setTextSelection(int location,int end) { m_selectionLocation = location; m_selectionLength = end-location; }
  void onKeyPressChange(int,const std::string&) {}
  void emitCommittedKeyPress(const std::string&,const std::string&,int,int);
  void setTextContent(const std::string& content) { m_content = content; m_textInputNode.setTextContent(content); m_textAreaNode.setTextContent(content); }
};
/* INPUT_CHANGE */
/* AREA_CHANGE */
/* COMPONENT_CHANGE */
/* COMPONENT_METRICS */
/* COMPONENT_COMMAND */
/* COMMITTED_KEY */
int main() {
  /* CASE */
  for (auto& delivery : deliveries) delivery();
  for (auto [start,length] : commandSelections) std::cout << "{\"commandSelection\":[" << start << "," << length << "]}\n";
}
