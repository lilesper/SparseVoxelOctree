#ifndef MYVK_COMMAND_POOL_HPP
#define MYVK_COMMAND_POOL_HPP

#include "DeviceObjectBase.hpp"
#include "Queue.hpp"
#include <volk.h>
#include <memory>
#include <cinttypes>

namespace myvk {
	class CommandPool : public DeviceObjectBase {
	private:
		std::shared_ptr<Queue> m_queue_ptr;

		VkCommandPool m_command_pool{nullptr};

	public:
		static std::shared_ptr<CommandPool>
		Create(const std::shared_ptr<Queue> &queue, VkCommandPoolCreateFlags flags = 0);

		VkCommandPool GetHandle() const { return m_command_pool; }

		const std::shared_ptr<Queue> &GetQueuePtr() const { return m_queue_ptr; }

		const std::shared_ptr<Device> &GetDevicePtr() const override { return m_queue_ptr->GetDevicePtr(); };

		~CommandPool();
	};
}

#endif