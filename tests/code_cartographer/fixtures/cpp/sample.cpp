#include <iostream>
#include <vector>
#include <string>
#include <memory>

#include "config.h"
#include "utils/logger.h"
#include "../shared/types.h"

namespace app {
namespace core {

const int MAX_BUFFER_SIZE = 4096;

class BaseProcessor {
public:
    BaseProcessor(const std::string& name) : name_(name) {}
    virtual ~BaseProcessor() = default;
    virtual void process(const std::vector<uint8_t>& data) = 0;

protected:
    std::string name_;
};

class DataProcessor : public BaseProcessor {
public:
    DataProcessor(const Config& config)
        : BaseProcessor("data"), config_(config) {}

    void process(const std::vector<uint8_t>& data) override;
    int getBufferSize() const { return buffer_size_; }

private:
    Config config_;
    int buffer_size_ = MAX_BUFFER_SIZE;
    void validateInput(const std::vector<uint8_t>& data);
};

struct ProcessResult {
    bool success;
    std::string message;
    int items_processed;
};

template<typename T>
class GenericCache {
public:
    void put(const std::string& key, T value);
    T get(const std::string& key) const;
    bool contains(const std::string& key) const;
private:
    std::vector<std::pair<std::string, T>> entries_;
};

enum class LogLevel {
    Debug,
    Info,
    Warning,
    Error,
};

ProcessResult run_pipeline(const Config& config);
void initialize(const std::string& config_path);

} // namespace core
} // namespace app
