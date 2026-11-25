#include "supervision.h"
namespace {
using namespace SmartBin;
constexpr GuardState fresh;
constexpr auto low1=guardStep(fresh,0,0,2,3);
constexpr auto low2=guardStep(low1,0,0,2,3);
constexpr auto ready=guardStep(low2,0,0,2,3);
static_assert(!low1.emptyVerified && !low2.emptyVerified && ready.emptyVerified,"Three low pairs establish an empty reference");
constexpr auto startupHigh=guardStep(fresh,95,95,2,3);
static_assert(!startupHigh.result.full && startupHigh.result.state==LevelState::HighUnverified,"Covered sensors at boot must not establish fullness");
static_assert(!guardStep(startupHigh,95,95,2,3).result.full,"Waiting cannot identify a fixed covering");
constexpr auto jump=guardStep(ready,95,95,2,3);
static_assert(jump.suspect && jump.result.state==LevelState::InspectionRequired && !jump.result.full,"A sheet spanning both sensors can cause an abrupt high jump");
constexpr auto stillCovered=guardStep(jump,95,95,2,3);
static_assert(stillCovered.suspect && !stillCovered.result.full,"A stable covering must remain suspect");
constexpr auto clear1=guardStep(stillCovered,0,0,2,3);
constexpr auto clear2=guardStep(clear1,0,0,2,3);
constexpr auto clear3=guardStep(clear2,0,0,2,3);
static_assert(clear1.suspect && clear2.suspect && !clear3.suspect && clear3.emptyVerified,"Recovery requires three truly low pairs");
constexpr auto mid=guardStep(ready,50,50,2,3);
constexpr auto rising=guardStep(mid,80,80,2,3);
constexpr auto top1=guardStep(rising,92,94,2,3);
constexpr auto top2=guardStep(top1,92,94,2,3);
constexpr auto top3=guardStep(top2,92,94,2,3);
static_assert(!top1.result.full && !top2.result.full && top3.result.full,"Progressive rise plus repeated high pairs permits likely full");
constexpr auto onePoint=guardStep(ready,95,0,1,3);
static_assert(!onePoint.result.full,"A single sensor cannot confirm fullness");
constexpr auto disagree1=guardStep(rising,94,20,2,3);
constexpr auto disagree2=guardStep(disagree1,94,20,2,3);
constexpr auto disagree3=guardStep(disagree2,94,20,2,3);
static_assert(disagree3.suspect && !disagree3.result.full,"Persistent disagreement is suspicious");
static_assert(!guardStep(GuardState(),0,95,2,3).emptyVerified,"Bag covering just one region cannot pass empty verification");
static_assert(guardStep(ready,101,50,2,3).result.state==LevelState::SensorFault,"Invalid physical data is a fault");
static_assert(!nearEmpty(16,0,2) && nearEmpty(15,15,2),"Empty installation threshold");
static_assert(commandFresh(1000,6000) && !commandFresh(6000,6000),"Reject expired command");
static_assert(!commandFresh(1000,500) && !commandFresh(1000,11001),"Reject stale or unbounded deadline");
static_assert(commandFresh(0xfffffff0u,0x20u),"Command deadline survives millis wrap");
static_assert(elapsed(0x20u,0xfffffff0u)==48,"Presence and lid hold clocks survive rollover");
}
