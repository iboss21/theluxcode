#include <fstream>
#include <sstream>
#include <iostream>
#include "minja.hpp"

static std::string slurp(const char* p) {
    std::ifstream f(p);
    if (!f) { std::cerr << "cannot open " << p << "\n"; exit(2); }
    std::stringstream ss; ss << f.rdbuf(); return ss.str();
}

int main(int argc, char** argv) {
    if (argc < 3) { std::cerr << "usage: render TEMPLATE CONTEXT.json\n"; return 2; }
    std::string tmpl_str = slurp(argv[1]);
    auto ctx_json = nlohmann::ordered_json::parse(slurp(argv[2]));
    try {
        // Same whitespace policy transformers uses.
        auto tmpl = minja::Parser::parse(tmpl_str, {true, true, false});
        auto ctx = minja::Context::make(minja::Value(ctx_json));
        std::cout << tmpl->render(ctx);
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "MINJA ERROR: " << e.what() << "\n";
        return 1;
    }
}
