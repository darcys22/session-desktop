/* global ConversationController: false */
/* global extension: false */
/* global getInboxCollection: false */
/* global getContactCollection: false */
/* global i18n: false */
/* global Whisper: false */
/* global textsecure: false */
/* global Signal: false */
/* global StringView: false */
/* global storage: false */

// eslint-disable-next-line func-names
(function() {
  'use strict';

  window.Whisper = window.Whisper || {};

  Whisper.ConversationStack = Whisper.View.extend({
    className: 'conversation-stack',
    open(conversation) {
      const id = `conversation-${conversation.cid}`;
      if (id !== this.el.firstChild.id) {
        this.$el
          .first()
          .find('video, audio')
          .each(function pauseMedia() {
            this.pause();
          });
        let $el = this.$(`#${id}`);
        if ($el === null || $el.length === 0) {
          const view = new Whisper.ConversationView({
            model: conversation,
            window: this.model.window,
          });
          // eslint-disable-next-line prefer-destructuring
          $el = view.$el;
        }
        $el.prependTo(this.el);
      }
      conversation.trigger('opened');
    },
    close(conversation) {
      const $el = this.$(`#conversation-${conversation.cid}`);
      if ($el && $el.length > 0) {
        $el.remove();
      }
    },
  });

  Whisper.FontSizeView = Whisper.View.extend({
    defaultSize: 14,
    maxSize: 30,
    minSize: 14,
    initialize() {
      this.currentSize = this.defaultSize;
      this.render();
    },
    events: { keydown: 'zoomText' },
    zoomText(e) {
      if (!e.ctrlKey) {
        return;
      }
      const keyCode = e.which || e.keyCode;
      const maxSize = 22; // if bigger text goes outside send-message textarea
      const minSize = 14;
      if (keyCode === 189 || keyCode === 109) {
        if (this.currentSize > minSize) {
          this.currentSize -= 1;
        }
      } else if (keyCode === 187 || keyCode === 107) {
        if (this.currentSize < maxSize) {
          this.currentSize += 1;
        }
      }
      this.render();
    },
    render() {
      this.$el.css('font-size', `${this.currentSize}px`);
    },
  });

  Whisper.AppLoadingScreen = Whisper.View.extend({
    templateName: 'app-loading-screen',
    className: 'app-loading-screen',
    updateProgress(count) {
      if (count > 0) {
        const message = i18n('loadingMessages', count.toString());
        this.$('.message').text(message);
      }
    },
    render_attributes: {
      message: i18n('loading'),
    },
  });

  Whisper.InboxView = Whisper.View.extend({
    templateName: 'two-column',
    className: 'inbox index',
    initialize(options = {}) {
      this.ready = false;
      this.render();
      this.$el.attr('tabindex', '1');

      // eslint-disable-next-line no-new
      new Whisper.FontSizeView({ el: this.$el });

      this.mainHeaderView = new Whisper.MainHeaderView({
        el: this.$('.main-header-placeholder'),
      });

      this.conversation_stack = new Whisper.ConversationStack({
        el: this.$('.conversation-stack'),
        model: { window: options.window },
      });

      if (!options.initialLoadComplete) {
        this.appLoadingScreen = new Whisper.AppLoadingScreen();
        this.appLoadingScreen.render();
        this.appLoadingScreen.$el.prependTo(this.el);
        this.startConnectionListener();
      }

      // Inbox
      const inboxCollection = getInboxCollection();

      this.listenTo(inboxCollection, 'messageError', () => {
        if (this.networkStatusView) {
          this.networkStatusView.render();
        }
      });
      this.listenTo(inboxCollection, 'select', this.openConversation);

      this.inboxListView = new Whisper.ConversationListView({
        el: this.$('.inbox'),
        collection: inboxCollection,
      }).render();

      this.inboxListView.listenTo(
        inboxCollection,
        'add change:timestamp change:name change:number change:profileName',
        this.inboxListView.updateLocation
      );

      // Listen to any conversation remove
      this.listenTo(
        inboxCollection,
        'remove',
        this.closeConversation
      );

      // Friends
      const contactCollection = getContactCollection();

      this.listenTo(contactCollection, 'select', this.openConversation);

      this.contactListView = new Whisper.ConversationContactListView({
        el: this.$('.friends'),
        collection: contactCollection,
      }).render();

      this.contactListView.listenTo(
        contactCollection,
        'add change:timestamp change:name change:number change:profileName',
        this.contactListView.updateLocation
      );

      this.listenTo(
        contactCollection,
        'remove',
        this.contactListView.removeItem
      );

      // Search
      this.searchView = new Whisper.ConversationSearchView({
        el: this.$('.search-results'),
        input: this.$('input.search'),
      });

      this.searchView.$el.hide();

      this.listenTo(this.searchView, 'hide', function toggleVisibility() {
        this.searchView.$el.hide();
        this.$('.conversations-list').show();
      });
      this.listenTo(this.searchView, 'show', function toggleVisibility() {
        this.searchView.$el.show();
        this.$('.conversations-list').hide();
      });
      this.listenTo(this.searchView, 'open', this.openConversation);

      this.networkStatusView = new Whisper.NetworkStatusView();
      this.$el
        .find('.network-status-container')
        .append(this.networkStatusView.render().el);

      extension.windows.onClosed(() => {
        this.inboxListView.stopListening();
        this.contactListView.stopListening();
      });

      if (extension.expired()) {
        const banner = new Whisper.ExpiredAlertBanner().render();
        banner.$el.prependTo(this.$el);
        this.$el.addClass('expired');
      }
    },
    render_attributes() {
      return {
        welcomeToSignal: i18n('welcomeToSignal'),
        selectAContact: i18n('selectAContact'),
        searchForPeopleOrGroups: i18n('searchForPeopleOrGroups'),
        settings: i18n('settings'),
      };
    },
    events: {
      click: 'onClick',
      'click #header': 'focusHeader',
      'click .conversation': 'focusConversation',
      'click .section-toggle': 'toggleSection',
      'input input.search': 'filterContacts',
    },
    startConnectionListener() {
      this.interval = setInterval(() => {
        const status = window.getSocketStatus();
        switch (status) {
          case WebSocket.CONNECTING:
            break;
          case WebSocket.OPEN:
            clearInterval(this.interval);
            // if we've connected, we can wait for real empty event
            this.interval = null;
            break;
          case WebSocket.CLOSING:
          case WebSocket.CLOSED:
            clearInterval(this.interval);
            this.interval = null;
            // if we failed to connect, we pretend we got an empty event
            this.onEmpty();
            break;
          default:
            window.log.error(
              'Whisper.InboxView::startConnectionListener:',
              'Unknown web socket status:',
              status
            );
            break;
        }
      }, 1000);
    },
    onEmpty() {
      const view = this.appLoadingScreen;
      if (view) {
        this.appLoadingScreen = null;
        view.remove();
      }
    },
    onProgress(count) {
      const view = this.appLoadingScreen;
      if (view) {
        view.updateProgress(count);
      }
    },
    focusConversation(e) {
      if (e && this.$(e.target).closest('.placeholder').length) {
        return;
      }

      this.$('#header, .gutter').addClass('inactive');
      this.$('.conversation-stack').removeClass('inactive');
    },
    focusHeader() {
      this.$('.conversation-stack').addClass('inactive');
      this.$('#header, .gutter').removeClass('inactive');
      this.$('.conversation:first .menu').trigger('close');
    },
    reloadBackgroundPage() {
      window.location.reload();
    },
    filterContacts(e) {
      this.searchView.filterContacts(e);
      const input = this.$('input.search');
      if (input.val().length > 0) {
        input.addClass('active');
        const textDir = window.getComputedStyle(input[0]).direction;
        if (textDir === 'ltr') {
          input.removeClass('rtl').addClass('ltr');
        } else if (textDir === 'rtl') {
          input.removeClass('ltr').addClass('rtl');
        }
      } else {
        input.removeClass('active');
      }
    },
    toggleSection(e) {
      // Expand or collapse this panel
      const $target = this.$(e.target);
      const $next = $target.next();

      // Toggle section visibility
      $next.slideToggle('fast');
      $target.toggleClass('section-toggle-visible');
    },
    openConversation(conversation) {
      this.searchView.hideHints();
      if (conversation) {
        conversation.updateProfile();
        ConversationController.markAsSelected(conversation);
        this.conversation_stack.open(
          ConversationController.get(conversation.id)
        );
        this.focusConversation();
      }
    },
    closeConversation(conversation) {
      if (conversation) {
        this.inboxListView.removeItem(conversation);
        this.conversation_stack.close(conversation);
      }
    },
    closeRecording(e) {
      if (e && this.$(e.target).closest('.capture-audio').length > 0) {
        return;
      }
      this.$('.conversation:first .recorder').trigger('close');
    },
    onClick(e) {
      this.closeRecording(e);
    },
  });

  Whisper.ExpiredAlertBanner = Whisper.View.extend({
    templateName: 'expired_alert',
    className: 'expiredAlert clearfix',
    render_attributes() {
      return {
        expiredWarning: i18n('expiredWarning'),
        upgrade: i18n('upgrade'),
      };
    },
  });
})();
