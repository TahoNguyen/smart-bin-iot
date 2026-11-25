#include "bin_logic.h"
// Compile-time behavioral tests of the same transition function the firmware uses.
namespace {
using namespace SmartBin;
constexpr Evaluation start;
constexpr auto high1=evaluateLevel(start,92,94,2,3);
constexpr auto high2=evaluateLevel(high1,92,94,2,3);
constexpr auto high3=evaluateLevel(high2,92,94,2,3);
static_assert(!high1.full && !high2.full && high3.full,"Require three new high pairs");
static_assert(evaluateLevel(start,90,90,2,3).state==LevelState::Normal,"Exactly 90 is not high");
static_assert(evaluateLevel(high3,87,86,2,3).full,"Hold confirmed full in hysteresis band");
static_assert(!evaluateLevel(high3,84,86,2,3).full,"A low region clears full");
constexpr auto mismatch1=evaluateLevel(start,95,20,2,3);
constexpr auto mismatch2=evaluateLevel(mismatch1,95,20,2,3);
constexpr auto mismatch3=evaluateLevel(mismatch2,95,20,2,3);
static_assert(mismatch1.state==LevelState::Checking && mismatch3.state==LevelState::ObstructionSuspected,"Persistent spatial disagreement is suspected obstruction");
static_assert(!mismatch3.full,"Obstruction must never be full");
static_assert(evaluateLevel(high3,95,20,2,3).state==LevelState::Checking,"Mismatch clears an existing full result immediately");
constexpr auto interrupted=evaluateLevel(high2,40,40,2,3);
static_assert(!evaluateLevel(interrupted,92,94,2,3).full,"Interrupted confirmation starts again");
constexpr auto single=evaluateLevel(start,100,0,1,3);
static_assert(!single.full && single.state==LevelState::HighUnverified,"One sensor cannot establish fullness");
static_assert(evaluateLevel(single,87,0,1,3).state==LevelState::HighUnverified,"Single high uses hysteresis");
static_assert(evaluateLevel(single,84,0,1,3).state==LevelState::Normal,"Single high clears below 85");
static_assert(evaluateLevel(start,-1,50,2,3).state==LevelState::SensorFault,"Reject invalid percentages");
static_assert(evaluateLevel(start,50,50,2,0).state==LevelState::SensorFault,"Reject zero confirmation count");
static_assert(!evaluateLevel(Evaluation(LevelState::SensorFault),92,94,2,3).full,"Fault recovery must reconfirm");
static_assert(!evaluateLevel(Evaluation(LevelState::Settling),92,94,2,3).full,"Lid settling resets confirmation");
}
